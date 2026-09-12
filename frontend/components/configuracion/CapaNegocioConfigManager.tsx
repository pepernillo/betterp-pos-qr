"use client";

import { buildApiUrl } from '@/lib/api';

import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  ConfigFieldLabel,
  ConfigInfoButton,
  ConfigInfoModal,
  type ConfigInfoContent,
} from "./ConfigInfo";
import ReglasMarcoManager from "./ReglasMarcoManager";

const EMPRESAS_API_BASE = buildApiUrl("/empresas");
const FACTURACION_API_BASE = buildApiUrl("/facturacion");

interface FacturacionProviderStatus {
  proveedor: string;
  modo: string;
  entorno_url: string;
  credenciales_configuradas: boolean;
  campos_negocio_listos: boolean;
  listo_para_sandbox: boolean;
  listo_para_produccion?: boolean;
  listo_para_emitir?: boolean;
  pendientes: string[];
  recomendacion: string;
  csd?: {
    id: number;
    proveedor: string;
    modo: string;
    rfc: string;
    numero_certificado?: string | null;
    estatus: string;
    activo: boolean;
    ultimo_error?: string | null;
    actualizado_en?: string | null;
  } | null;
  credenciales_env?: {
    username?: string;
    password?: string;
  };
}

type MensajeTipo = "success" | "error" | "info";

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
  pais_fiscal: string | null;
  codigo_postal_fiscal: string | null;
  estado_fiscal: string | null;
  municipio_fiscal: string | null;
  colonia_fiscal: string | null;
  calle_fiscal: string | null;
  numero_exterior_fiscal: string | null;
  numero_interior_fiscal: string | null;
  facturacion_activa: boolean;
  facturacion_modo: string;
  facturacion_pac_proveedor: string;
  facturacion_serie_ingresos: string;
  facturacion_lugar_expedicion: string | null;
  facturacion_producto_servicio: string | null;
  facturacion_unidad: string;
  facturacion_uso_cfdi_default: string;
  facturacion_metodo_pago_default: string;
  facturacion_forma_pago_default: string;
  portal_clientes_activo: boolean;
  portal_clientes_url_base: string | null;
  seguridad_doble_factor_activa: boolean;
  clabe_transferencias: string | null;
  banco_transferencias: string | null;
  beneficiario_transferencias: string | null;
  referencia_transferencia_prefijo: string;
  plazo_meses_default: number;
  periodicidad_cobro_default: string;
  dia_vencimiento_default: number | null;
  dias_gracia_default: number;
  auto_renueva_default: boolean;
  aplicacion_pagos: string;
  activo: boolean;
  entidades_count: number;
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
  portal_clientes_activo: boolean;
  portal_clientes_url_base: string;
  seguridad_doble_factor_activa: boolean;
  clabe_transferencias: string;
  banco_transferencias: string;
  beneficiario_transferencias: string;
  referencia_transferencia_prefijo: string;
  plazo_meses_default: string;
  periodicidad_cobro_default: string;
  dia_vencimiento_default: string;
  dias_gracia_default: string;
  auto_renueva_default: boolean;
  aplicacion_pagos: string;
  activo: boolean;
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
  facturacion_serie_ingresos: "A",
  facturacion_lugar_expedicion: "",
  facturacion_producto_servicio: "",
  facturacion_unidad: "E48",
  facturacion_uso_cfdi_default: "G03",
  facturacion_metodo_pago_default: "PUE",
  facturacion_forma_pago_default: "03",
  portal_clientes_activo: false,
  portal_clientes_url_base: "",
  seguridad_doble_factor_activa: false,
  clabe_transferencias: "",
  banco_transferencias: "",
  beneficiario_transferencias: "",
  referencia_transferencia_prefijo: "BETT",
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
  { value: "ADEUDO_MAS_ANTIGUO", label: "Aplicar al adeudo mas antiguo" },
  { value: "SALDO_A_FAVOR", label: "Conservar saldo a favor" },
];

const MODOS_FACTURACION = [
  { value: "MANUAL", label: "Manual / preparacion" },
  { value: "SANDBOX", label: "PAC sandbox" },
  { value: "PRODUCCION", label: "PAC produccion" },
];

const PAC_PROVEEDORES = [
  { value: "SIN_PROVEEDOR", label: "Sin proveedor" },
  { value: "FACTURAMA", label: "Facturama" },
  { value: "FACTURAPI", label: "Facturapi" },
  { value: "FISCALAPI", label: "FiscalAPI" },
  { value: "FINKOK", label: "Finkok" },
  { value: "SW", label: "SW Sapien" },
  { value: "OTRO", label: "Otro" },
];

type ConfigTabId = "capas" | "reglas" | "datos" | "facturacion";

const CONFIG_TABS: Array<{
  id: ConfigTabId;
  label: string;
  helper: string;
}> = [
  {
    id: "capas",
    label: "Capas registradas",
    helper: "Selecciona, crea o edita la capa base del negocio.",
  },
  {
    id: "reglas",
    label: "Reglas de capa de negocio",
    helper: "Define periodicidad, gracia y politicas heredables.",
  },
  {
    id: "datos",
    label: "Datos fiscales",
    helper: "Configura RFC, domicilio y datos del emisor.",
  },
  {
    id: "facturacion",
    label: "Facturacion",
    helper: "Conecta PAC, portal de clientes y referencias bancarias.",
  },
];

const MAX_CSD_FILE_SIZE_BYTES = 8 * 1024 * 1024;

const configInfo = {
  general: {
    eyebrow: "Configuracion base",
    title: "Datos de negocio",
    summary:
      "Esta seccion identifica la capa operativa que heredan tus entidades: nombre interno, tipo de operacion, contacto principal y logo visible.",
    details: [
      "Usa nombres claros y estables. Esta capa puede representar una operadora, administradora, grupo, hotel o empresa matriz.",
      "El correo y telefono se usan como contacto operativo; no sustituyen los datos fiscales del emisor.",
      "El logo debe ser una URL publica segura si quieres mostrarlo en vistas o comunicaciones del cliente.",
    ],
  },
  nombre: {
    eyebrow: "Campo obligatorio",
    title: "Nombre de la capa",
    summary:
      "Nombre operativo que el equipo usara para reconocer esta base de reglas y datos compartidos.",
    details: [
      "Debe tener de 3 a 120 caracteres.",
      "Evita codigos temporales o datos fiscales completos; usa algo entendible para soporte y administracion.",
    ],
  },
  contacto: {
    eyebrow: "Contacto operativo",
    title: "Correo y telefono",
    summary:
      "Datos de contacto para administracion de la capa. Ayudan a identificar al responsable operativo.",
    details: [
      "El correo debe tener formato valido y maximo 120 caracteres.",
      "El telefono solo acepta numeros, de 10 a 15 digitos, para evitar extensiones o texto en campos operativos.",
    ],
  },
  datosFiscales: {
    eyebrow: "Emisor fiscal",
    title: "Datos fiscales",
    summary:
      "Datos base del emisor que se usaran cuando la capa emita facturas o prepare CFDI para sus clientes.",
    details: [
      "RFC acepta 12 o 13 caracteres alfanumericos y se guarda en mayusculas.",
      "El codigo postal fiscal debe tener 5 digitos y tambien puede alimentar el lugar de expedicion.",
      "Razon social, regimen y domicilio deben coincidir con la Constancia de Situacion Fiscal.",
    ],
  },
  facturacion: {
    eyebrow: "CFDI y portal",
    title: "Facturacion y portal",
    summary:
      "Concentra el modo de facturacion, proveedor PAC, claves SAT, portal del cliente y datos bancarios para pagos referenciados.",
    details: [
      "Las claves SAT tienen longitudes especificas: producto de 8 digitos, unidad corta como E48, uso CFDI como G03, metodo como PUE y forma de pago de 2 digitos.",
      "La URL del portal debe iniciar con http:// o https://.",
      "La CLABE se limita a 18 digitos y el prefijo de referencia a codigos cortos en mayusculas.",
    ],
  },
  csd: {
    eyebrow: "Timbrado",
    title: "Certificado de sello digital",
    summary:
      "El CSD permite timbrar facturas del emisor. Se registra por capa, proveedor y modo para separar sandbox y produccion.",
    details: [
      "Solo acepta archivos .cer y .key de hasta 8 MB cada uno.",
      "La contrasena de la llave privada debe tener de 4 a 120 caracteres.",
      "Antes de cargar CSD conviene guardar razon social, regimen fiscal y codigo postal fiscal.",
    ],
  },
  reglas: {
    eyebrow: "Operacion recurrente",
    title: "Reglas operativas default",
    summary:
      "Definen como nacen los periodos de cobro, cuando vencen, cuantos dias de gracia tienen y como se aplican pagos.",
    details: [
      "Plazo, dia de vencimiento y dias de gracia solo aceptan enteros.",
      "Dia de vencimiento va de 1 a 31; dias de gracia va de 0 a 365.",
      "Estas reglas son la base heredable; las excepciones se manejan por entidad, cliente o contrato cuando aplique.",
    ],
  },
  seguridad: {
    eyebrow: "Acceso",
    title: "Doble factor",
    summary:
      "Agrega una validacion adicional por correo para usuarios que entren a esta capa.",
    details: [
      "Conviene activarlo cuando varias personas administran datos fiscales, cobros o conciliacion.",
      "No cambia roles ni permisos; solo agrega una verificacion de acceso.",
    ],
  },
};

function sanitizeText(value: string, maxLength = 120) {
  return value.replace(/[<>]/g, "").slice(0, maxLength);
}

function sanitizeDigits(value: string, maxLength: number) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function sanitizeUpperCode(value: string, maxLength: number) {
  return value
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .toUpperCase()
    .slice(0, maxLength);
}

function sanitizeRfc(value: string) {
  return value
    .replace(/[^a-zA-Z0-9&\u00d1\u00f1]/g, "")
    .toUpperCase()
    .slice(0, 13);
}

function sanitizeIntegerInput(value: string, max: number) {
  const digits = value.replace(/\D/g, "").slice(0, String(max).length);
  if (!digits) {
    return "";
  }
  return String(Math.min(Number(digits), max));
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidUrl(value: string) {
  if (!value.trim()) {
    return true;
  }
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function hasAllowedRfcShape(value: string) {
  return /^[A-Z0-9&\u00d1]{12,13}$/.test(value);
}

function validateCapaForm(form: CapaFormState, activeTab: ConfigTabId) {
  const nombre = form.nombre.trim();
  if (nombre.length < 3 || nombre.length > 120) {
    return "Nombre de la capa es obligatorio y debe tener de 3 a 120 caracteres.";
  }

  if (form.correo_contacto.trim() && !isValidEmail(form.correo_contacto.trim())) {
    return "Correo contacto debe tener formato valido.";
  }

  const telefono = sanitizeDigits(form.telefono_contacto, 15);
  if (telefono && (telefono.length < 10 || telefono.length > 15)) {
    return "Telefono contacto debe tener de 10 a 15 digitos.";
  }

  if (form.logo_url.trim() && !isValidUrl(form.logo_url)) {
    return "Logo URL debe iniciar con http:// o https://.";
  }

  if (activeTab === "datos" || activeTab === "facturacion") {
    const rfc = form.rfc.trim().toUpperCase();
    if (rfc && !hasAllowedRfcShape(rfc)) {
      return "RFC emisor debe tener 12 o 13 caracteres alfanumericos.";
    }

    const cpFiscal = sanitizeDigits(form.codigo_postal_fiscal, 5);
    if (cpFiscal && cpFiscal.length !== 5) {
      return "Codigo postal fiscal debe tener exactamente 5 digitos.";
    }
  }

  if (activeTab === "facturacion") {
    const lugar = sanitizeDigits(form.facturacion_lugar_expedicion, 5);
    if (lugar && lugar.length !== 5) {
      return "Lugar de expedicion debe tener exactamente 5 digitos.";
    }
    const claveSat = sanitizeDigits(form.facturacion_producto_servicio, 8);
    if (claveSat && claveSat.length !== 8) {
      return "Clave producto SAT debe tener exactamente 8 digitos.";
    }
    const formaPago = sanitizeDigits(form.facturacion_forma_pago_default, 2);
    if (formaPago && formaPago.length !== 2) {
      return "Forma pago default debe tener 2 digitos.";
    }
    if (form.portal_clientes_url_base.trim() && !isValidUrl(form.portal_clientes_url_base)) {
      return "URL base del portal debe iniciar con http:// o https://.";
    }
    const clabe = sanitizeDigits(form.clabe_transferencias, 18);
    if (clabe && clabe.length !== 18) {
      return "CLABE debe tener exactamente 18 digitos.";
    }
  }

  if (activeTab === "reglas") {
    const plazo = Number(form.plazo_meses_default);
    if (!Number.isInteger(plazo) || plazo < 1 || plazo > 120) {
      return "Plazo default debe ser un entero de 1 a 120 meses.";
    }

    if (form.dia_vencimiento_default) {
      const dia = Number(form.dia_vencimiento_default);
      if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
        return "Dia de vencimiento debe ser un entero del 1 al 31.";
      }
    }

    const gracia = Number(form.dias_gracia_default);
    if (!Number.isInteger(gracia) || gracia < 0 || gracia > 365) {
      return "Dias de gracia debe ser un entero de 0 a 365.";
    }
  }

  return "";
}

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
    pais_fiscal: capa.pais_fiscal || "Mexico",
    codigo_postal_fiscal: capa.codigo_postal_fiscal || "",
    estado_fiscal: capa.estado_fiscal || "",
    municipio_fiscal: capa.municipio_fiscal || "",
    colonia_fiscal: capa.colonia_fiscal || "",
    calle_fiscal: capa.calle_fiscal || "",
    numero_exterior_fiscal: capa.numero_exterior_fiscal || "",
    numero_interior_fiscal: capa.numero_interior_fiscal || "",
    facturacion_activa: Boolean(capa.facturacion_activa),
    facturacion_modo: capa.facturacion_modo || "MANUAL",
    facturacion_pac_proveedor:
      capa.facturacion_pac_proveedor || "SIN_PROVEEDOR",
    facturacion_serie_ingresos: capa.facturacion_serie_ingresos || "A",
    facturacion_lugar_expedicion: capa.facturacion_lugar_expedicion || "",
    facturacion_producto_servicio: capa.facturacion_producto_servicio || "",
    facturacion_unidad: capa.facturacion_unidad || "E48",
    facturacion_uso_cfdi_default: capa.facturacion_uso_cfdi_default || "G03",
    facturacion_metodo_pago_default:
      capa.facturacion_metodo_pago_default || "PUE",
    facturacion_forma_pago_default:
      capa.facturacion_forma_pago_default || "03",
    portal_clientes_activo: Boolean(capa.portal_clientes_activo),
    portal_clientes_url_base: capa.portal_clientes_url_base || "",
    seguridad_doble_factor_activa: Boolean(capa.seguridad_doble_factor_activa),
    clabe_transferencias: capa.clabe_transferencias || "",
    banco_transferencias: capa.banco_transferencias || "",
    beneficiario_transferencias: capa.beneficiario_transferencias || "",
    referencia_transferencia_prefijo:
      capa.referencia_transferencia_prefijo || "BETT",
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

function buildPayloadFromForm(form: CapaFormState) {
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
    pais_fiscal: form.pais_fiscal.trim() || "Mexico",
    codigo_postal_fiscal: form.codigo_postal_fiscal.trim(),
    estado_fiscal: form.estado_fiscal.trim(),
    municipio_fiscal: form.municipio_fiscal.trim(),
    colonia_fiscal: form.colonia_fiscal.trim(),
    calle_fiscal: form.calle_fiscal.trim(),
    numero_exterior_fiscal: form.numero_exterior_fiscal.trim(),
    numero_interior_fiscal: form.numero_interior_fiscal.trim(),
    facturacion_serie_ingresos:
      form.facturacion_serie_ingresos.trim().toUpperCase() || "A",
    facturacion_lugar_expedicion: form.facturacion_lugar_expedicion.trim(),
    facturacion_producto_servicio: form.facturacion_producto_servicio.trim(),
    facturacion_unidad: form.facturacion_unidad.trim().toUpperCase() || "E48",
    facturacion_uso_cfdi_default:
      form.facturacion_uso_cfdi_default.trim().toUpperCase() || "G03",
    facturacion_metodo_pago_default:
      form.facturacion_metodo_pago_default.trim().toUpperCase() || "PUE",
    facturacion_forma_pago_default:
      form.facturacion_forma_pago_default.trim() || "03",
    portal_clientes_url_base: form.portal_clientes_url_base.trim(),
    seguridad_doble_factor_activa: form.seguridad_doble_factor_activa,
    clabe_transferencias: form.clabe_transferencias.replace(/\D/g, ""),
    banco_transferencias: form.banco_transferencias.trim(),
    beneficiario_transferencias: form.beneficiario_transferencias.trim(),
    referencia_transferencia_prefijo:
      form.referencia_transferencia_prefijo.trim().toUpperCase() || "BETT",
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

export default function CapaNegocioConfigManager() {
  const [capas, setCapas] = useState<CapaNegocio[]>([]);
  const [selectedCapaId, setSelectedCapaId] = useState<number | null>(null);
  const [form, setForm] = useState<CapaFormState>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingFacturacionStatus, setIsLoadingFacturacionStatus] =
    useState(false);
  const [facturacionStatus, setFacturacionStatus] =
    useState<FacturacionProviderStatus | null>(null);
  const [isFacturacionOpen, setIsFacturacionOpen] = useState(false);
  const [isUploadingCsd, setIsUploadingCsd] = useState(false);
  const [csdCerFile, setCsdCerFile] = useState<File | null>(null);
  const [csdKeyFile, setCsdKeyFile] = useState<File | null>(null);
  const [csdPassword, setCsdPassword] = useState("");
  const [activeTab, setActiveTab] = useState<ConfigTabId>("capas");
  const [infoModal, setInfoModal] = useState<ConfigInfoContent | null>(null);
  const [mensaje, setMensaje] = useState("");
  const [mensajeTipo, setMensajeTipo] = useState<MensajeTipo>("success");

  const selectedCapa = useMemo(
    () => capas.find((item) => item.id === selectedCapaId) || null,
    [capas, selectedCapaId]
  );

  const activeTabMeta =
    CONFIG_TABS.find((tab) => tab.id === activeTab) || CONFIG_TABS[0];

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncTabFromUrl = () => {
      const tab = new URLSearchParams(window.location.search).get("tab");
      if (CONFIG_TABS.some((item) => item.id === tab)) {
        setActiveTab(tab as ConfigTabId);
      }
    };

    syncTabFromUrl();
    window.addEventListener("popstate", syncTabFromUrl);
    return () => window.removeEventListener("popstate", syncTabFromUrl);
  }, []);

  const showMensaje = (
    texto: string,
    tipo: MensajeTipo = "success",
    autoHide = false
  ) => {
    setMensaje(texto);
    setMensajeTipo(tipo);
    if (autoHide) {
      window.setTimeout(() => setMensaje(""), 3000);
    }
  };

  const loadFacturacionStatus = async (targetCapaId?: number | null) => {
    const capaId = targetCapaId ?? selectedCapaId;
    if (!capaId) {
      setFacturacionStatus(null);
      return;
    }

    setIsLoadingFacturacionStatus(true);
    try {
      const response = await fetch(
        `${FACTURACION_API_BASE}/proveedor/status/?capa_id=${capaId}`,
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error("No se pudo revisar la configuracion de facturacion.");
      }

      const body = (await response.json()) as FacturacionProviderStatus;
      setFacturacionStatus(body);
    } catch (error) {
      console.error("Error cargando estado de facturacion:", error);
      setFacturacionStatus(null);
    } finally {
      setIsLoadingFacturacionStatus(false);
    }
  };

  const uploadCsd = async () => {
    if (!selectedCapaId) {
      showMensaje("Selecciona una capa de negocio antes de cargar el CSD.", "error");
      return;
    }
    const pendientesFiscales = [
      ["razon social fiscal", form.razon_social],
      ["regimen fiscal", form.regimen_fiscal],
      ["codigo postal fiscal", form.codigo_postal_fiscal],
    ].filter(([, value]) => !String(value || "").trim());
    if (pendientesFiscales.length) {
      showMensaje(
        `Primero completa y guarda: ${pendientesFiscales
          .map(([label]) => label)
          .join(", ")}.`,
        "error"
      );
      setActiveTab("datos");
      return;
    }
    if (!csdCerFile || !csdKeyFile || !csdPassword.trim()) {
      showMensaje("Selecciona archivo .cer, archivo .key y contrasena privada.", "error");
      return;
    }
    if (!csdCerFile.name.toLowerCase().endsWith(".cer")) {
      showMensaje("El certificado debe ser un archivo .cer.", "error");
      return;
    }
    if (!csdKeyFile.name.toLowerCase().endsWith(".key")) {
      showMensaje("La llave privada debe ser un archivo .key.", "error");
      return;
    }
    if (
      csdCerFile.size > MAX_CSD_FILE_SIZE_BYTES ||
      csdKeyFile.size > MAX_CSD_FILE_SIZE_BYTES
    ) {
      showMensaje("Los archivos CSD no deben superar 8 MB cada uno.", "error");
      return;
    }
    if (csdPassword.trim().length < 4 || csdPassword.trim().length > 120) {
      showMensaje("La contrasena privada debe tener de 4 a 120 caracteres.", "error");
      return;
    }

    const formData = new FormData();
    formData.append("capa_id", String(selectedCapaId));
    formData.append("proveedor", form.facturacion_pac_proveedor || "FACTURAMA");
    formData.append("modo", form.facturacion_modo || "SANDBOX");
    formData.append("password", csdPassword.trim());
    formData.append("cer_file", csdCerFile);
    formData.append("key_file", csdKeyFile);

    setIsUploadingCsd(true);
    setMensaje("");
    try {
      const response = await fetch(`${FACTURACION_API_BASE}/emisor/csd/`, {
        method: "POST",
        body: formData,
      });
      const rawBody = await response.text();
      let parsedBody: unknown = {};
      try {
        parsedBody = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        parsedBody = {
          detail: rawBody.includes("Server Error")
            ? "El servidor no pudo registrar el CSD. Revisa el log del backend."
            : rawBody,
        };
      }
      const body = parsedBody as {
        mensaje?: string;
        detail?: string;
        status?: FacturacionProviderStatus;
        csd?: FacturacionProviderStatus["csd"];
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo cargar el CSD.");
      }
      if (body.status) {
        setFacturacionStatus(body.status);
      } else {
        await loadFacturacionStatus(selectedCapaId);
      }
      setCsdCerFile(null);
      setCsdKeyFile(null);
      setCsdPassword("");
      if (body.csd?.estatus === "ERROR") {
        showMensaje(
          body.csd.ultimo_error
            ? `Facturama rechazo el CSD: ${body.csd.ultimo_error}`
            : "Facturama rechazo el CSD. Revisa los archivos y la contrasena privada.",
          "error"
        );
        return;
      }
      showMensaje(body.mensaje || "CSD cargado correctamente.", "success");
    } catch (error) {
      showMensaje(
        error instanceof Error ? error.message : "No se pudo cargar el CSD.",
        "error"
      );
    } finally {
      setIsUploadingCsd(false);
    }
  };

  const loadCapas = async (preferredSelectedId?: number | null) => {
    setIsLoading(true);
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
        preferredSelectedId !== undefined ? preferredSelectedId : selectedCapaId;

      if (targetId) {
        const updatedSelected = body.find((item) => item.id === targetId);
        if (updatedSelected) {
          setSelectedCapaId(updatedSelected.id);
          setForm(mapCapaToForm(updatedSelected));
          return;
        }
      }

      if (body.length > 0) {
        setSelectedCapaId(body[0].id);
        setForm(mapCapaToForm(body[0]));
      }
    } catch (error) {
      console.error("Error cargando capas:", error);
      setCapas([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadCapas();
  }, []);

  useEffect(() => {
    void loadFacturacionStatus(selectedCapaId);
  }, [selectedCapaId]);

  const openNewCapa = () => {
    setSelectedCapaId(null);
    setForm(EMPTY_FORM);
    setActiveTab("capas");
  };

  const handleSelectCapa = (capa: CapaNegocio) => {
    setSelectedCapaId(capa.id);
    setForm(mapCapaToForm(capa));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationError = validateCapaForm(form, activeTab);
    if (validationError) {
      showMensaje(validationError, "error");
      return;
    }

    setIsSaving(true);

    const payload = buildPayloadFromForm(form);

    const url = selectedCapaId
      ? `${EMPRESAS_API_BASE}/capas/${selectedCapaId}/`
      : `${EMPRESAS_API_BASE}/capas/`;
    const method = selectedCapaId ? "PUT" : "POST";

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = (await response.json()) as unknown;
        throw new Error(getErrorMessage(errorBody, "No se pudo guardar la capa."));
      }

      const body = (await response.json()) as { id?: number };
      const nextSelectedId = selectedCapaId || body.id || null;
      setSelectedCapaId(nextSelectedId);
      showMensaje(
        selectedCapaId
          ? "Capa de negocio actualizada correctamente."
          : "Capa de negocio creada correctamente.",
        "success",
        true
      );
      await loadCapas(nextSelectedId);
      await loadFacturacionStatus(nextSelectedId);
    } catch (error) {
      console.error("Error guardando capa:", error);
      alert(error instanceof Error ? error.message : "No se pudo guardar la capa.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleClone = async () => {
    if (!selectedCapa) {
      return;
    }

    setIsSaving(true);
    try {
      const clonePayload = buildPayloadFromForm({
        ...mapCapaToForm(selectedCapa),
        nombre: `${selectedCapa.nombre} (Copia)`,
      });

      const response = await fetch(`${EMPRESAS_API_BASE}/capas/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clonePayload),
      });

      if (!response.ok) {
        const errorBody = (await response.json()) as unknown;
        throw new Error(
          getErrorMessage(errorBody, "No se pudo clonar la capa de negocio.")
        );
      }

      const body = (await response.json()) as { id?: number };
      const nextSelectedId = body.id || null;
      setSelectedCapaId(nextSelectedId);
      showMensaje("Capa de negocio clonada correctamente.", "success", true);
      await loadCapas(nextSelectedId);
    } catch (error) {
      console.error("Error clonando capa:", error);
      alert(
        error instanceof Error
          ? error.message
          : "No se pudo clonar la capa de negocio."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedCapa) {
      return;
    }

    const confirmed = window.confirm(
      `Vas a eliminar la capa "${selectedCapa.nombre}". Esta accion no se puede deshacer.`
    );
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `${EMPRESAS_API_BASE}/capas/${selectedCapa.id}/`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        const errorBody = (await response.json()) as unknown;
        throw new Error(
          getErrorMessage(errorBody, "No se pudo eliminar la capa de negocio.")
        );
      }

      showMensaje("Capa de negocio eliminada correctamente.", "success", true);
      setSelectedCapaId(null);
      setForm(EMPTY_FORM);
      await loadCapas(null);
    } catch (error) {
      console.error("Error eliminando capa:", error);
      alert(
        error instanceof Error
          ? error.message
          : "No se pudo eliminar la capa de negocio."
      );
    }
  };

  return (
    <div className="space-y-6">
      <ConfigInfoModal info={infoModal} onClose={() => setInfoModal(null)} />
      <div className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950 to-zinc-900 p-6 shadow-xl">
        <div className="max-w-4xl space-y-3">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-white">
              Datos de negocio y facturacion
            </h1>
            <ConfigInfoButton info={configInfo.general} onOpen={setInfoModal} />
          </div>
          <p className="text-sm text-zinc-400">
            Aqui defines la operadora, administradora o grupo que envuelve a tus
            entidades. Desde este nivel configuras datos fiscales, transferencia
            referenciada, portal de clientes, reglas marco y la base comercial
            que luego heredan las propiedades.
          </p>
        </div>
      </div>

      {mensaje && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            mensajeTipo === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-200"
              : mensajeTipo === "info"
                ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
                : "border-green-500/30 bg-green-500/10 text-green-300"
          }`}
        >
          {mensaje}
        </div>
      )}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-2">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          {CONFIG_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === "facturacion") {
                  setIsFacturacionOpen(true);
                }
              }}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                activeTab === tab.id
                  ? "border-cyan-500/40 bg-cyan-500/10 text-white"
                  : "border-transparent text-zinc-500 hover:border-zinc-800 hover:bg-zinc-900/60 hover:text-zinc-200"
              }`}
            >
              <span className="block text-sm font-semibold">{tab.label}</span>
              <span className="mt-1 block text-xs text-zinc-500">
                {tab.helper}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div
        className={
          activeTab === "capas"
            ? "grid grid-cols-1 gap-6 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]"
            : "space-y-6"
        }
      >
        {activeTab === "capas" && (
        <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Capas registradas</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Selecciona una capa para editarla o crea una nueva.
              </p>
            </div>
            <button
              onClick={openNewCapa}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
            >
              Nueva
            </button>
          </div>

          {isLoading ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 py-10 text-center text-sm text-zinc-500">
              Cargando capas...
            </div>
          ) : capas.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 py-10 text-center text-sm text-zinc-500">
              Todavia no hay capas de negocio registradas.
            </div>
          ) : (
            <div className="space-y-3">
              {capas.map((capa) => (
                <button
                  key={capa.id}
                  onClick={() => handleSelectCapa(capa)}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${
                    selectedCapaId === capa.id
                      ? "border-cyan-500/30 bg-cyan-500/10"
                      : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-white">{capa.nombre}</h3>
                      <p className="mt-1 text-sm text-zinc-500">{capa.tipo_capa}</p>
                    </div>
                    <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300">
                      {capa.entidades_count} entidades
                    </span>
                  </div>
                  <div className="mt-3 text-xs text-zinc-400">
                    {capa.periodicidad_cobro_default} - plazo {capa.plazo_meses_default} meses
                    {capa.dia_vencimiento_default
                      ? ` - vence dia ${capa.dia_vencimiento_default}`
                      : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
        )}

        <div className="space-y-6">
          <section className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
            <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {activeTab === "capas"
                    ? selectedCapaId
                      ? "Editar capa"
                      : "Nueva capa"
                    : activeTabMeta.label}
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {activeTab === "capas"
                    ? "Define la base compartida que heredaran tus entidades."
                    : activeTabMeta.helper}
                </p>
              </div>

              {selectedCapa && activeTab === "capas" && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClone}
                    disabled={isSaving}
                    className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
                  >
                    Clonar capa
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20"
                  >
                    Eliminar capa
                  </button>
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {activeTab === "capas" && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <ConfigFieldLabel
                    required
                    info={configInfo.nombre}
                    onInfo={setInfoModal}
                  >
                    Nombre
                  </ConfigFieldLabel>
                  <input
                    required
                    type="text"
                    minLength={3}
                    maxLength={120}
                    placeholder="Ej. Operadora Maya"
                    value={form.nombre}
                    onChange={(event) =>
                      setForm({ ...form, nombre: sanitizeText(event.target.value, 120) })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <ConfigFieldLabel
                    required
                    info={configInfo.general}
                    onInfo={setInfoModal}
                  >
                    Tipo
                  </ConfigFieldLabel>
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
                  <ConfigFieldLabel
                    optional
                    info={configInfo.contacto}
                    onInfo={setInfoModal}
                  >
                    Administrador responsable
                  </ConfigFieldLabel>
                  <input
                    type="text"
                    maxLength={120}
                    placeholder="Ej. Backoffice central"
                    value={form.nombre_administrador}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        nombre_administrador: sanitizeText(event.target.value, 120),
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <ConfigFieldLabel
                    optional
                    info={configInfo.contacto}
                    onInfo={setInfoModal}
                  >
                    Correo contacto
                  </ConfigFieldLabel>
                  <input
                    type="email"
                    maxLength={120}
                    placeholder="operacion@empresa.com"
                    value={form.correo_contacto}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        correo_contacto: sanitizeText(event.target.value, 120),
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <ConfigFieldLabel
                    optional
                    info={configInfo.contacto}
                    onInfo={setInfoModal}
                  >
                    Telefono contacto
                  </ConfigFieldLabel>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={15}
                    placeholder="Ej. 5512345678"
                    value={form.telefono_contacto}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        telefono_contacto: sanitizeDigits(event.target.value, 15),
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <ConfigFieldLabel
                    optional
                    info={configInfo.general}
                    onInfo={setInfoModal}
                  >
                    Logo URL
                  </ConfigFieldLabel>
                  <input
                    type="url"
                    maxLength={250}
                    placeholder="https://..."
                    value={form.logo_url}
                    onChange={(event) =>
                      setForm({ ...form, logo_url: sanitizeText(event.target.value, 250) })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
              </div>
              )}

              {activeTab === "datos" && (
              <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/25 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-white">
                      Datos fiscales del negocio
                    </h3>
                    <ConfigInfoButton
                      info={configInfo.datosFiscales}
                      onOpen={setInfoModal}
                    />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    Esta informacion sera la base del emisor cuando conectemos el
                    PAC para timbrar facturas.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <div className="xl:col-span-2">
                    <ConfigFieldLabel
                      optional
                      info={configInfo.datosFiscales}
                      onInfo={setInfoModal}
                    >
                      Razon social fiscal
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      maxLength={180}
                      placeholder="Ej. MAYA COLIVING S.A. DE C.V."
                      value={form.razon_social}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          razon_social: sanitizeText(event.target.value, 180),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <ConfigFieldLabel
                      optional
                      info={configInfo.datosFiscales}
                      onInfo={setInfoModal}
                    >
                      RFC emisor
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      maxLength={13}
                      placeholder="Ej. XAXX010101000"
                      value={form.rfc}
                      onChange={(event) =>
                        setForm({ ...form, rfc: sanitizeRfc(event.target.value) })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm uppercase text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <ConfigFieldLabel
                      optional
                      info={configInfo.datosFiscales}
                      onInfo={setInfoModal}
                    >
                      Regimen fiscal
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      maxLength={120}
                      placeholder="Ej. 601 - General de Ley Personas Morales"
                      value={form.regimen_fiscal}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          regimen_fiscal: sanitizeText(event.target.value, 120),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <ConfigFieldLabel
                      optional
                      info={configInfo.datosFiscales}
                      onInfo={setInfoModal}
                    >
                      Pais fiscal
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      maxLength={80}
                      placeholder="Mexico"
                      value={form.pais_fiscal}
                      onChange={(event) =>
                        setForm({ ...form, pais_fiscal: sanitizeText(event.target.value, 80) })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <ConfigFieldLabel
                      optional
                      info={configInfo.datosFiscales}
                      onInfo={setInfoModal}
                    >
                      Codigo postal fiscal
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={5}
                      placeholder="Ej. 01729"
                      value={form.codigo_postal_fiscal}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          codigo_postal_fiscal: sanitizeDigits(event.target.value, 5),
                          facturacion_lugar_expedicion:
                            form.facturacion_lugar_expedicion ||
                            sanitizeDigits(event.target.value, 5),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-400">
                      Estado
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      placeholder="Ej. Ciudad de Mexico"
                      value={form.estado_fiscal}
                      onChange={(event) =>
                        setForm({ ...form, estado_fiscal: sanitizeText(event.target.value, 100) })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-400">
                      Municipio / alcaldia
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      placeholder="Ej. Alvaro Obregon"
                      value={form.municipio_fiscal}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          municipio_fiscal: sanitizeText(event.target.value, 100),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-400">
                      Colonia
                    </label>
                    <input
                      type="text"
                      maxLength={120}
                      placeholder="Ej. Alcantarilla"
                      value={form.colonia_fiscal}
                      onChange={(event) =>
                        setForm({ ...form, colonia_fiscal: sanitizeText(event.target.value, 120) })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div className="xl:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-zinc-400">
                      Calle
                    </label>
                    <input
                      type="text"
                      maxLength={160}
                      placeholder="Ej. Desierto de los Leones"
                      value={form.calle_fiscal}
                      onChange={(event) =>
                        setForm({ ...form, calle_fiscal: sanitizeText(event.target.value, 160) })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-400">
                      Numero exterior
                    </label>
                    <input
                      type="text"
                      maxLength={20}
                      placeholder="Ej. 5547"
                      value={form.numero_exterior_fiscal}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          numero_exterior_fiscal: sanitizeText(event.target.value, 20),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-zinc-400">
                      Numero interior
                    </label>
                    <input
                      type="text"
                      maxLength={20}
                      placeholder="Ej. B1001"
                      value={form.numero_interior_fiscal}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          numero_interior_fiscal: sanitizeText(event.target.value, 20),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>
                </div>
              </div>
              )}

              {activeTab === "facturacion" && (
              <div className="space-y-4 rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-white">
                        Facturacion y portal de clientes
                      </h3>
                      <ConfigInfoButton
                        info={configInfo.facturacion}
                        onOpen={setInfoModal}
                      />
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      Preparamos la configuracion para facturas, portal privado y
                      transferencias con referencia. Las credenciales del PAC se
                      conectan como variables de entorno, no como texto visible.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsFacturacionOpen((current) => !current)}
                      className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-900"
                    >
                      <span
                        className={`flex h-5 w-9 items-center rounded-full border p-0.5 transition-colors ${
                          isFacturacionOpen
                            ? "border-cyan-400/50 bg-cyan-500/20"
                            : "border-zinc-700 bg-zinc-900"
                        }`}
                      >
                        <span
                          className={`h-3.5 w-3.5 rounded-full transition-transform ${
                            isFacturacionOpen
                              ? "translate-x-4 bg-cyan-300"
                              : "bg-zinc-500"
                          }`}
                        />
                      </span>
                      {isFacturacionOpen ? "Ocultar detalle" : "Ver detalle"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsFacturacionOpen(true);
                        setForm({
                          ...form,
                          facturacion_activa: true,
                          facturacion_modo: "SANDBOX",
                          facturacion_pac_proveedor: "FACTURAMA",
                        });
                      }}
                      className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/20"
                    >
                      Usar Facturama sandbox
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      Proveedor
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-white">
                      {PAC_PROVEEDORES.find(
                        (item) => item.value === form.facturacion_pac_proveedor
                      )?.label || "Sin proveedor"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      Modo
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-white">
                      {MODOS_FACTURACION.find(
                        (item) => item.value === form.facturacion_modo
                      )?.label || "Manual"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      Portal
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {form.portal_clientes_activo ? "Activo" : "Inactivo"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      Referencia
                    </p>
                    <p className="mt-1 truncate text-sm font-semibold text-white">
                      {form.clabe_transferencias
                        ? "CLABE lista"
                        : form.referencia_transferencia_prefijo || "Sin CLABE"}
                    </p>
                  </div>
                </div>

                <div
                  className={`rounded-2xl border p-4 ${
                    facturacionStatus?.listo_para_sandbox
                      ? "border-green-500/25 bg-green-500/10"
                      : "border-amber-500/25 bg-amber-500/10"
                  }`}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        Estado del PAC
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {facturacionStatus
                          ? facturacionStatus.recomendacion
                          : "Guarda la capa y revisa si faltan variables o datos fiscales."}
                      </p>
                      {facturacionStatus?.entorno_url ? (
                        <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                          Entorno: {facturacionStatus.entorno_url}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadFacturacionStatus(selectedCapaId)}
                      disabled={!selectedCapaId || isLoadingFacturacionStatus}
                      className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-900 disabled:opacity-50"
                    >
                      {isLoadingFacturacionStatus ? "Revisando..." : "Revisar"}
                    </button>
                  </div>

                  {facturacionStatus?.pendientes?.length ? (
                    <div className="mt-3 space-y-1">
                      {facturacionStatus.pendientes.slice(0, 5).map((item) => (
                        <p key={item} className="text-xs text-amber-100">
                          - {item}
                        </p>
                      ))}
                    </div>
                  ) : facturacionStatus?.listo_para_sandbox ? (
                    <p className="mt-3 text-xs text-green-200">
                      Configuracion local lista para construir CFDI de prueba.
                    </p>
                  ) : null}
                </div>

                {isFacturacionOpen ? (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-white">
                            Certificado de sello digital
                          </h4>
                          <ConfigInfoButton
                            info={configInfo.csd}
                            onOpen={setInfoModal}
                            className="h-5 w-5 text-[10px]"
                          />
                        </div>
                        <p className="mt-1 text-xs leading-5 text-zinc-500">
                          Carga el .cer, .key y contrasena de la capa emisora.
                          BettERP guarda el certificado por proveedor y modo para
                          que despues puedas cambiar de PAC sin rehacer la logica.
                        </p>
                        <p className="mt-2 text-xs leading-5 text-zinc-500">
                          Si ya cargaste el CSD en el panel web de Facturama,
                          sigue siendo necesario registrarlo desde BettERP para
                          que la emision por API multiemisor quede vinculada a
                          esta capa de negocio.
                        </p>
                        {facturacionStatus?.csd ? (
                          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
                            <p className="font-medium text-zinc-200">
                              {facturacionStatus.csd.rfc} | {facturacionStatus.csd.modo} |{" "}
                              {facturacionStatus.csd.estatus}
                            </p>
                            {facturacionStatus.csd.ultimo_error ? (
                              <p className="mt-1 text-amber-200">
                                {facturacionStatus.csd.ultimo_error}
                              </p>
                            ) : (
                              <p className="mt-1">
                                Certificado activo para timbrado multiemisor.
                              </p>
                            )}
                          </div>
                        ) : null}
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2 lg:w-[520px]">
                        <label className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
                          Archivo .cer
                          <input
                            type="file"
                            accept=".cer"
                            onChange={(event) =>
                              setCsdCerFile(event.target.files?.[0] || null)
                            }
                            className="mt-2 w-full text-xs text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-xs file:text-zinc-200"
                          />
                        </label>
                        <label className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
                          Archivo .key
                          <input
                            type="file"
                            accept=".key"
                            onChange={(event) =>
                              setCsdKeyFile(event.target.files?.[0] || null)
                            }
                            className="mt-2 w-full text-xs text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-xs file:text-zinc-200"
                          />
                        </label>
                        <label className="sm:col-span-2">
                          <ConfigFieldLabel
                            required
                            info={configInfo.csd}
                            onInfo={setInfoModal}
                          >
                            Contrasena llave privada
                          </ConfigFieldLabel>
                          <input
                            type="password"
                            minLength={4}
                            maxLength={120}
                            value={csdPassword}
                            onChange={(event) =>
                              setCsdPassword(sanitizeText(event.target.value, 120))
                            }
                            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => void uploadCsd()}
                          disabled={isUploadingCsd || !selectedCapaId}
                          className="sm:col-span-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
                        >
                          {isUploadingCsd
                            ? "Validando CSD..."
                            : "Registrar CSD para timbrado"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {isFacturacionOpen ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={form.facturacion_activa}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          facturacion_activa: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500"
                    />
                    Facturacion activa
                  </label>

                  <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={form.portal_clientes_activo}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          portal_clientes_activo: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500"
                    />
                    Portal cliente activo
                  </label>

                  <div>
                    <ConfigFieldLabel optional info={configInfo.facturacion} onInfo={setInfoModal}>
                      Modo
                    </ConfigFieldLabel>
                    <select
                      value={form.facturacion_modo}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          facturacion_modo: event.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                    >
                      {MODOS_FACTURACION.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <ConfigFieldLabel optional info={configInfo.facturacion} onInfo={setInfoModal}>
                      Proveedor PAC
                    </ConfigFieldLabel>
                    <select
                      value={form.facturacion_pac_proveedor}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          facturacion_pac_proveedor: event.target.value,
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                    >
                      {PAC_PROVEEDORES.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <ConfigFieldLabel optional info={configInfo.facturacion} onInfo={setInfoModal}>
                      Serie ingresos
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      maxLength={8}
                      placeholder="A"
                      value={form.facturacion_serie_ingresos}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          facturacion_serie_ingresos:
                            sanitizeUpperCode(event.target.value, 8),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm uppercase text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <ConfigFieldLabel optional info={configInfo.facturacion} onInfo={setInfoModal}>
                      Lugar expedicion
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={5}
                      placeholder="CP emisor"
                      value={form.facturacion_lugar_expedicion}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          facturacion_lugar_expedicion: sanitizeDigits(event.target.value, 5),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <ConfigFieldLabel optional info={configInfo.facturacion} onInfo={setInfoModal}>
                      Clave producto SAT
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={8}
                      placeholder="Ej. 80131500"
                      value={form.facturacion_producto_servicio}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          facturacion_producto_servicio: sanitizeDigits(event.target.value, 8),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <ConfigFieldLabel optional info={configInfo.facturacion} onInfo={setInfoModal}>
                      Unidad SAT
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      maxLength={10}
                      placeholder="E48"
                      value={form.facturacion_unidad}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          facturacion_unidad: sanitizeUpperCode(event.target.value, 10),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm uppercase text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <ConfigFieldLabel optional info={configInfo.facturacion} onInfo={setInfoModal}>
                      Uso CFDI default
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      maxLength={4}
                      placeholder="G03"
                      value={form.facturacion_uso_cfdi_default}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          facturacion_uso_cfdi_default:
                            sanitizeUpperCode(event.target.value, 4),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm uppercase text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <ConfigFieldLabel optional info={configInfo.facturacion} onInfo={setInfoModal}>
                      Metodo pago default
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      maxLength={3}
                      placeholder="PUE"
                      value={form.facturacion_metodo_pago_default}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          facturacion_metodo_pago_default:
                            sanitizeUpperCode(event.target.value, 3),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm uppercase text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <ConfigFieldLabel optional info={configInfo.facturacion} onInfo={setInfoModal}>
                      Forma pago default
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={2}
                      placeholder="03 transferencia"
                      value={form.facturacion_forma_pago_default}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          facturacion_forma_pago_default: sanitizeDigits(event.target.value, 2),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <ConfigFieldLabel optional info={configInfo.facturacion} onInfo={setInfoModal}>
                      URL base del portal
                    </ConfigFieldLabel>
                    <input
                      type="url"
                      maxLength={250}
                      placeholder="https://tudominio.com/portal"
                      value={form.portal_clientes_url_base}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          portal_clientes_url_base: sanitizeText(event.target.value, 250),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <ConfigFieldLabel optional info={configInfo.facturacion} onInfo={setInfoModal}>
                      Beneficiario transferencia
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      maxLength={120}
                      placeholder="Nombre como aparece en el banco"
                      value={form.beneficiario_transferencias}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          beneficiario_transferencias: sanitizeText(event.target.value, 120),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <ConfigFieldLabel optional info={configInfo.facturacion} onInfo={setInfoModal}>
                      Banco
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      maxLength={80}
                      placeholder="Ej. BBVA"
                      value={form.banco_transferencias}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          banco_transferencias: sanitizeText(event.target.value, 80),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <ConfigFieldLabel optional info={configInfo.facturacion} onInfo={setInfoModal}>
                      CLABE
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={18}
                      placeholder="18 digitos"
                      value={form.clabe_transferencias}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          clabe_transferencias: sanitizeDigits(event.target.value, 18),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <ConfigFieldLabel optional info={configInfo.facturacion} onInfo={setInfoModal}>
                      Prefijo referencia
                    </ConfigFieldLabel>
                    <input
                      type="text"
                      maxLength={12}
                      placeholder="BETT"
                      value={form.referencia_transferencia_prefijo}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          referencia_transferencia_prefijo:
                            sanitizeUpperCode(event.target.value, 12),
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm uppercase text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>
                </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/50 px-4 py-3 text-xs text-zinc-500">
                    El detalle fiscal esta oculto para mantener limpia la vista.
                    Activa "Ver detalle" solo cuando necesites editar CFDI, PAC,
                    portal o referencias bancarias.
                  </div>
                )}
              </div>
              )}

              {activeTab === "reglas" && (
              <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/25 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-white">
                      Reglas operativas default
                    </h3>
                    <ConfigInfoButton info={configInfo.reglas} onOpen={setInfoModal} />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    Estos valores son la configuracion base que usa cobranza para
                    generar periodos, vencimientos, gracia y aplicacion de pagos.
                  </p>
                </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div>
                  <ConfigFieldLabel required info={configInfo.reglas} onInfo={setInfoModal}>
                    Periodicidad default
                  </ConfigFieldLabel>
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
                  <ConfigFieldLabel required info={configInfo.reglas} onInfo={setInfoModal}>
                    Plazo default (meses)
                  </ConfigFieldLabel>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={3}
                    value={form.plazo_meses_default}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        plazo_meses_default: sanitizeIntegerInput(event.target.value, 120),
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <ConfigFieldLabel optional info={configInfo.reglas} onInfo={setInfoModal}>
                    Dia de vencimiento
                  </ConfigFieldLabel>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    placeholder="Ej. 5"
                    value={form.dia_vencimiento_default}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        dia_vencimiento_default: sanitizeIntegerInput(event.target.value, 31),
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <ConfigFieldLabel required info={configInfo.reglas} onInfo={setInfoModal}>
                    Dias de gracia
                  </ConfigFieldLabel>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={3}
                    value={form.dias_gracia_default}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        dias_gracia_default: sanitizeIntegerInput(event.target.value, 365),
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <ConfigFieldLabel required info={configInfo.reglas} onInfo={setInfoModal}>
                    Aplicacion de pagos
                  </ConfigFieldLabel>
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

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-white">
                      Seguridad de acceso
                    </h4>
                    <ConfigInfoButton
                      info={configInfo.seguridad}
                      onOpen={setInfoModal}
                      className="ml-2 h-5 w-5 text-[10px]"
                    />
                    <p className="mt-1 text-xs leading-6 text-zinc-500">
                      Cuando activas doble factor, cualquier usuario que entre a
                      esta capa debera validar un codigo adicional enviado por
                      correo despues de su contrasena o Google.
                    </p>
                  </div>
                  <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={form.seguridad_doble_factor_activa}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          seguridad_doble_factor_activa: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500"
                    />
                    Autenticacion en 2 pasos por correo
                  </label>
                </div>
              </div>
              </div>
              )}

              <div className="flex justify-end gap-3 border-t border-zinc-800 pt-5">
                <button
                  type="button"
                  onClick={openNewCapa}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
                >
                  Limpiar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-lg bg-cyan-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
                >
                  {isSaving
                    ? "Guardando..."
                    : selectedCapaId
                      ? "Guardar cambios"
                      : "Crear capa"}
                </button>
              </div>
            </form>
          </section>

          {activeTab === "reglas" && selectedCapa && (
            <ReglasMarcoManager
              capaId={selectedCapa.id}
              capaNombre={selectedCapa.nombre}
            />
          )}

          {activeTab === "reglas" && !selectedCapa && (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/70 p-6 text-sm text-zinc-500">
              Selecciona una capa registrada o crea una nueva para configurar
              reglas heredables.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
