"use client";

import { buildApiUrl } from '@/lib/api';

import { type ChangeEvent, useEffect, useState } from "react";

import {
  GENERIC_PUBLIC_NAME,
  GENERIC_PUBLIC_REGIME,
  GENERIC_PUBLIC_RFC,
  getFiscalRegimeOptions,
  isGenericPublicRfc,
  normalizeFiscalRegimeValue,
} from "@/lib/fiscalRegimes";

const CRM_API_BASE = buildApiUrl("/crm");
const ESPACIOS_API_BASE = buildApiUrl("/espacios");

export interface ClienteEntityOption {
  id: number;
  nombre: string;
}

interface EspacioDisponibleOption {
  id: number;
  codigo: string;
  entidad_nombre?: string | null;
  tipo_nombre?: string | null;
  renta_sugerida?: number | null;
  deposito_sugerido?: number | null;
  estatus: string;
  cliente_actual_id?: number | null;
  asignacion_activa_id?: number | null;
}

export interface ClienteDetail {
  id: number;
  entidad_relacionada_id: number;
  entidad_relacionada_nombre: string;
  es_persona_moral: boolean;
  nombre_comercial?: string | null;
  razon_social: string;
  rfc: string;
  regimen_fiscal?: string | null;
  identificador?: string | null;
  condiciones_pago?: string | null;
  archivo_csf_url?: string | null;
  contrato_digital_url?: string | null;
  contrato_digital_nombre?: string | null;
  correo_principal?: string | null;
  codigo_pais: string;
  telefono: string;
  pais: string;
  estado?: string | null;
  ciudad?: string | null;
  colonia?: string | null;
  calle?: string | null;
  numero_exterior?: string | null;
  numero_interior?: string | null;
  codigo_postal?: string | null;
  agente_cobranza?: string | null;
  dia_corte_individual?: number | null;
  dias_gracia: number;
  consentimiento_cobranza_aceptado?: boolean;
  consentimiento_cobranza_fecha?: string | null;
  no_contactar_cobranza?: boolean;
  no_contactar_cobranza_motivo?: string | null;
  no_contactar_cobranza_fecha?: string | null;
  activo: boolean;
}

export type ClienteModalMode = "create" | "edit" | "clone";

interface ClienteFormModalProps {
  isOpen: boolean;
  mode: ClienteModalMode;
  cliente: ClienteDetail | null;
  entityOptions: ClienteEntityOption[];
  onClose: () => void;
  onSuccess?: (message?: string) => void;
}

interface ExtractedCsfData {
  es_persona_moral?: boolean;
  nombre_comercial?: string;
  razon_social?: string;
  rfc?: string;
  regimen_fiscal?: string;
  archivo_csf_url?: string;
  correo_principal?: string;
  estado?: string;
  ciudad?: string;
  colonia?: string;
  calle?: string;
  numero_exterior?: string;
  numero_interior?: string;
  codigo_postal?: string;
}

interface ClienteFormState {
  entidad_relacionada_id: number;
  espacio_asignado_id: number;
  fecha_inicio_asignacion: string;
  es_persona_moral: boolean;
  nombre_comercial: string;
  razon_social: string;
  rfc: string;
  regimen_fiscal: string;
  identificador: string;
  condiciones_pago: string;
  archivo_csf_url: string;
  correo_principal: string;
  codigo_pais: string;
  telefono: string;
  pais: string;
  estado: string;
  ciudad: string;
  colonia: string;
  calle: string;
  numero_exterior: string;
  numero_interior: string;
  codigo_postal: string;
  agente_cobranza: string;
  dia_corte_individual: string;
  dias_gracia: string;
  no_contactar_cobranza: boolean;
  no_contactar_cobranza_motivo: string;
  activo: boolean;
}

interface FieldInfo {
  title: string;
  body: string;
  details?: string[];
}

type ClienteFormErrors = Partial<Record<keyof ClienteFormState, string>>;

const CLIENT_FIELD_INFO = {
  entidad_relacionada_id: {
    title: "Entidad relacionada",
    body:
      "Unidad de negocio donde quedara registrado el cliente. Esta relacion controla inventario, cobranza, portal, reportes y reglas operativas.",
    details: [
      "Obligatorio.",
      "El cliente no se puede guardar sin entidad.",
      "Si asignas un espacio, debe pertenecer a esta misma entidad.",
    ],
  },
  espacio_asignado_id: {
    title: "Habitacion / espacio disponible",
    body:
      "Espacio libre que puedes asignar al crear el cliente. Solo aparecen espacios sin asignacion activa para evitar duplicidad operativa.",
    details: [
      "Opcional.",
      "Si lo dejas sin seleccionar, el cliente se crea sin ocupacion activa.",
      "Si seleccionas un espacio, tambien puedes definir la fecha real de inicio de estancia.",
    ],
  },
  fecha_inicio_asignacion: {
    title: "Fecha inicio de renta",
    body:
      "Dia operativo desde el que el cliente queda asignado al espacio. Sirve cuando el cliente se registra o paga hoy, pero su renta o estancia inicia antes o despues.",
    details: [
      "Obligatorio solo si seleccionas un espacio.",
      "Por default se usa el dia actual.",
      "Puedes moverlo a una fecha anterior o posterior segun el contrato real.",
    ],
  },
  es_persona_moral: {
    title: "Tipo de persona fiscal",
    body:
      "Indica si los datos fiscales corresponden a una persona fisica o a una persona moral. Esto cambia la longitud esperada del RFC y los regimenes disponibles.",
    details: [
      "Persona fisica: RFC de 13 caracteres y nombre completo.",
      "Persona moral: RFC de 12 caracteres y nombre / razon social.",
      "El RFC generico publico en general se trata como caso especial.",
    ],
  },
  archivo_csf_url: {
    title: "Constancia de Situacion Fiscal",
    body:
      "PDF de la CSF del receptor. BetterP puede extraer RFC, nombre fiscal, regimen y direccion para reducir errores de captura.",
    details: [
      "Opcional, pero recomendado si el cliente solicitara factura.",
      "Solo se acepta PDF.",
      "Los datos extraidos se pueden revisar y ajustar antes de guardar.",
    ],
  },
  nombre_comercial: {
    title: "Nombre comercial",
    body:
      "Alias operativo para identificar al cliente en listas internas. Puede ser distinto al nombre fiscal.",
    details: [
      "Opcional.",
      "Maximo 200 caracteres.",
      "Acepta letras, numeros y signos comunes como punto, coma, guion, diagonal y &.",
    ],
  },
  razon_social: {
    title: "Nombre / razon social",
    body:
      "Nombre fiscal del receptor tal como debe quedar para facturacion. En persona fisica normalmente es el nombre completo; en persona moral es la razon social.",
    details: [
      "Obligatorio.",
      "Debe tener entre 3 y 250 caracteres.",
      "Persona fisica solo acepta letras, espacios, apostrofe y guion.",
      "Persona moral acepta letras, numeros y signos legales comunes.",
    ],
  },
  rfc: {
    title: "RFC",
    body:
      "Clave fiscal del receptor. BetterP la guarda en mayusculas y filtra caracteres no permitidos para evitar rechazos posteriores.",
    details: [
      "Opcional para registrar y cobrar al cliente.",
      "Obligatorio solo cuando el cliente solicite factura.",
      "Persona fisica: 13 caracteres.",
      "Persona moral: 12 caracteres.",
      "Acepta letras, numeros y &. No uses espacios ni guiones.",
    ],
  },
  regimen_fiscal: {
    title: "Regimen fiscal",
    body:
      "Regimen SAT del receptor. Debe coincidir con la CSF para que una factura pueda timbrarse correctamente.",
    details: [
      "Opcional para cobranza.",
      "Obligatorio solo cuando el cliente solicite factura.",
      "Las opciones cambian segun persona fisica o moral.",
      "Usa el regimen vigente en la constancia del cliente.",
    ],
  },
  identificador: {
    title: "Identificador interno",
    body:
      "Clave interna opcional para cruzar al cliente contra expedientes, contratos, folios, CRM externo o archivos de migracion.",
    details: [
      "Opcional.",
      "Maximo 100 caracteres.",
      "Acepta letras, numeros, espacios, guion, diagonal, punto y #.",
    ],
  },
  condiciones_pago: {
    title: "Condiciones de pago",
    body:
      "Referencia operativa de plazo pactado con el cliente. Ayuda al equipo a entender si paga de contado o con credito.",
    details: [
      "Obligatorio.",
      "No genera por si solo una CxC; sirve como dato de control.",
    ],
  },
  correo_principal: {
    title: "Correo principal",
    body:
      "Correo de contacto para avisos, confirmaciones, portal y seguimiento administrativo del cliente.",
    details: [
      "Opcional.",
      "Debe tener formato de correo valido si se captura.",
      "Maximo 254 caracteres.",
    ],
  },
  codigo_pais: {
    title: "Codigo de pais",
    body:
      "Lada internacional del telefono principal. Se usa junto con el telefono para WhatsApp, cobranza y validaciones operativas.",
    details: ["Obligatorio.", "Por ahora se permiten MX (+52) y US (+1)."],
  },
  telefono: {
    title: "Telefono / WhatsApp",
    body:
      "Numero operativo para contacto y cobranza. BetterP solo permite digitos para evitar formatos inconsistentes.",
    details: [
      "Obligatorio.",
      "MX y US requieren 10 digitos sin lada.",
      "No uses espacios, parentesis, guiones ni texto.",
    ],
  },
  pais: {
    title: "Pais",
    body:
      "Pais de direccion fiscal u operativa del cliente. Sirve como referencia para facturacion y expedientes.",
    details: ["Obligatorio.", "Maximo 50 caracteres.", "Acepta letras y espacios."],
  },
  estado: {
    title: "Estado",
    body:
      "Estado, provincia o region de la direccion. Es util para reportes, fiscalizacion y expediente.",
    details: ["Opcional.", "Maximo 100 caracteres."],
  },
  ciudad: {
    title: "Ciudad",
    body:
      "Ciudad o municipio de la direccion. Ayuda a ubicar al cliente y completar expedientes.",
    details: ["Opcional.", "Maximo 100 caracteres."],
  },
  colonia: {
    title: "Colonia",
    body:
      "Colonia o asentamiento de la direccion. Puede venir de la CSF o capturarse manualmente.",
    details: ["Opcional.", "Maximo 150 caracteres."],
  },
  calle: {
    title: "Calle",
    body:
      "Calle de la direccion fiscal u operativa del cliente.",
    details: ["Opcional.", "Maximo 150 caracteres."],
  },
  numero_exterior: {
    title: "Numero exterior",
    body:
      "Numero exterior de la direccion. Puede incluir letras cuando el domicilio lo requiera.",
    details: ["Opcional.", "Maximo 50 caracteres."],
  },
  numero_interior: {
    title: "Numero interior",
    body:
      "Numero interior, departamento, oficina o referencia interna del domicilio.",
    details: ["Opcional.", "Maximo 50 caracteres."],
  },
  codigo_postal: {
    title: "Codigo postal",
    body:
      "Codigo postal fiscal del receptor. En Mexico es un dato clave para facturacion y debe coincidir con la CSF.",
    details: [
      "Opcional para registrar y cobrar al cliente.",
      "Obligatorio solo cuando el cliente solicite factura.",
      "Solo acepta 5 digitos.",
      "Para RFC generico publico en general se usa el CP del emisor al timbrar.",
    ],
  },
  agente_cobranza: {
    title: "Agente de cobranza",
    body:
      "Persona o equipo responsable de dar seguimiento a este cliente.",
    details: ["Opcional.", "Maximo 150 caracteres."],
  },
  no_contactar_cobranza: {
    title: "No contactar para cobranza",
    body:
      "Bloquea los mensajes de cobranza para este cliente sin desactivarlo de pagos, portal o facturacion.",
    details: [
      "Usalo cuando el cliente revoque autorizacion, exista una instruccion legal o el contacto deba quedar pausado.",
      "El motor de envios registra el intento como omitido y no llama a WhatsApp ni correo.",
      "Al desactivarlo, el cliente vuelve a quedar disponible para reglas normales de cobranza.",
    ],
  },
  no_contactar_cobranza_motivo: {
    title: "Motivo del bloqueo",
    body:
      "Nota breve para que el equipo entienda por que el cliente no debe recibir mensajes de cobranza.",
    details: [
      "Obligatorio si activas el bloqueo.",
      "Maximo 240 caracteres.",
      "Ejemplo: Revoco autorizacion por WhatsApp, contacto legal, cuenta en aclaracion.",
    ],
  },
  activo: {
    title: "Cliente activo",
    body:
      "Controla si el cliente participa en la operacion vigente. Si se desactiva, se conserva su historial.",
    details: [
      "Activo: aparece en flujos operativos.",
      "Inactivo: queda como referencia historica y evita nuevas acciones por defecto.",
    ],
  },
  dia_corte_individual: {
    title: "Dia de corte individual",
    body:
      "Dia del mes que se usara como corte especial para este cliente cuando su contrato no use el corte general de la entidad.",
    details: [
      "Opcional.",
      "Solo acepta numeros enteros del 1 al 31.",
      "Dejalo vacio si el cliente hereda la regla de la entidad.",
    ],
  },
  dias_gracia: {
    title: "Dias de gracia",
    body:
      "Dias de tolerancia antes de marcar el saldo como vencido o aplicar reglas de atraso.",
    details: [
      "Obligatorio.",
      "Solo acepta numeros enteros de 0 a 365.",
      "Usa 0 si no hay tolerancia especial.",
    ],
  },
} satisfies Record<string, FieldInfo>;

function applyGenericPublicDefaults(form: ClienteFormState): ClienteFormState {
  if (!isGenericPublicRfc(form.rfc)) {
    return form;
  }
  return {
    ...form,
    es_persona_moral: false,
    razon_social: GENERIC_PUBLIC_NAME,
    rfc: GENERIC_PUBLIC_RFC,
    regimen_fiscal: GENERIC_PUBLIC_REGIME,
    codigo_postal: "",
  };
}

function formatCurrency(value?: number | null) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function todayLocalDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function sanitizeDateInput(value: string) {
  return value.replace(/[^\d-]/g, "").slice(0, 10);
}

function isValidDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

function buildInitialForm(
  entityOptions: ClienteEntityOption[],
  cliente: ClienteDetail | null,
  mode: ClienteModalMode
): ClienteFormState {
  const defaultEntityId = mode === "edit" ? entityOptions[0]?.id ?? 0 : 0;
  if (!cliente) {
    return {
      entidad_relacionada_id: 0,
      espacio_asignado_id: 0,
      fecha_inicio_asignacion: todayLocalDate(),
      es_persona_moral: false,
      nombre_comercial: "",
      razon_social: "",
      rfc: "",
      regimen_fiscal: "",
      identificador: "",
      condiciones_pago: "Contado",
      archivo_csf_url: "",
      correo_principal: "",
      codigo_pais: "+52",
      telefono: "",
      pais: "Mexico",
      estado: "",
      ciudad: "",
      colonia: "",
      calle: "",
      numero_exterior: "",
      numero_interior: "",
      codigo_postal: "",
      agente_cobranza: "",
      dia_corte_individual: "",
      dias_gracia: "0",
      no_contactar_cobranza: false,
      no_contactar_cobranza_motivo: "",
      activo: true,
    };
  }

  return applyGenericPublicDefaults({
    entidad_relacionada_id:
      mode === "clone" ? 0 : cliente.entidad_relacionada_id || defaultEntityId,
    espacio_asignado_id: 0,
    fecha_inicio_asignacion: todayLocalDate(),
    es_persona_moral: cliente.es_persona_moral,
    nombre_comercial:
      mode === "clone"
        ? `${cliente.nombre_comercial || cliente.razon_social} Copia`
        : cliente.nombre_comercial || "",
    razon_social: cliente.razon_social || "",
    rfc: cliente.rfc || "",
    regimen_fiscal:
      normalizeFiscalRegimeValue(cliente.regimen_fiscal, cliente.es_persona_moral) ||
      "",
    identificador:
      mode === "clone"
        ? cliente.identificador
          ? `${cliente.identificador}-COPIA`
          : ""
        : cliente.identificador || "",
    condiciones_pago: cliente.condiciones_pago || "Contado",
    archivo_csf_url: cliente.archivo_csf_url || "",
    correo_principal: cliente.correo_principal || "",
    codigo_pais: cliente.codigo_pais || "+52",
    telefono: cliente.telefono || "",
    pais: cliente.pais || "Mexico",
    estado: cliente.estado || "",
    ciudad: cliente.ciudad || "",
    colonia: cliente.colonia || "",
    calle: cliente.calle || "",
    numero_exterior: cliente.numero_exterior || "",
    numero_interior: cliente.numero_interior || "",
    codigo_postal: cliente.codigo_postal || "",
    agente_cobranza: cliente.agente_cobranza || "",
    dia_corte_individual:
      cliente.dia_corte_individual !== null &&
      cliente.dia_corte_individual !== undefined
        ? String(cliente.dia_corte_individual)
        : "",
    dias_gracia: String(cliente.dias_gracia ?? 0),
    no_contactar_cobranza:
      mode === "clone" ? false : Boolean(cliente.no_contactar_cobranza),
    no_contactar_cobranza_motivo:
      mode === "clone" ? "" : cliente.no_contactar_cobranza_motivo || "",
    activo: mode === "clone" ? true : cliente.activo,
  });
}

function getModalCopy(mode: ClienteModalMode) {
  if (mode === "edit") {
    return {
      title: "Editar cliente",
      submitLabel: "GUARDAR CAMBIOS",
      successMessage: "Cliente actualizado correctamente.",
    };
  }

  if (mode === "clone") {
    return {
      title: "Clonar cliente",
      submitLabel: "CREAR COPIA",
      successMessage: "Cliente clonado correctamente.",
    };
  }

  return {
    title: "Agregar cliente",
    submitLabel: "GUARDAR",
    successMessage: "Cliente creado correctamente.",
  };
}

function sanitizeLimitedText(value: string, maxLength: number) {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, maxLength);
}

function collapseSpaces(value: string) {
  return value.replace(/\s{2,}/g, " ");
}

function sanitizeBusinessText(value: string, maxLength: number) {
  return collapseSpaces(
    sanitizeLimitedText(value, maxLength).replace(/[^\p{L}\p{N}\s.,&()/#_-]/gu, "")
  );
}

function sanitizePersonName(value: string, maxLength: number) {
  return collapseSpaces(
    sanitizeLimitedText(value, maxLength).replace(/[^\p{L}\s.'-]/gu, "")
  );
}

function sanitizeAddressText(value: string, maxLength: number) {
  return collapseSpaces(
    sanitizeLimitedText(value, maxLength).replace(/[^\p{L}\p{N}\s.,/#_-]/gu, "")
  );
}

function sanitizeIdentifier(value: string) {
  return collapseSpaces(
    sanitizeLimitedText(value, 100).replace(/[^\p{L}\p{N}\s./#_-]/gu, "")
  );
}

function sanitizeRfcInput(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9&]/g, "").slice(0, 13);
}

function sanitizeEmailInput(value: string) {
  return value.toLowerCase().replace(/\s/g, "").slice(0, 254);
}

function sanitizePhoneInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 15);
}

function sanitizePostalCodeInput(value: string) {
  return value.replace(/\D/g, "").slice(0, 5);
}

function sanitizeIntegerInput(value: string, maxDigits: number) {
  return value.replace(/\D/g, "").slice(0, maxDigits);
}

function normalizeClienteForm(form: ClienteFormState): ClienteFormState {
  const next: ClienteFormState = {
    ...form,
    fecha_inicio_asignacion: sanitizeDateInput(form.fecha_inicio_asignacion),
    nombre_comercial: sanitizeBusinessText(form.nombre_comercial, 200).trim(),
    razon_social: form.es_persona_moral
      ? sanitizeBusinessText(form.razon_social, 250).trim()
      : sanitizePersonName(form.razon_social, 250).trim(),
    rfc: sanitizeRfcInput(form.rfc),
    regimen_fiscal: sanitizeLimitedText(form.regimen_fiscal, 150).trim(),
    identificador: sanitizeIdentifier(form.identificador).trim(),
    condiciones_pago: ["Contado", "Credito 15 dias", "Credito 30 dias"].includes(
      form.condiciones_pago
    )
      ? form.condiciones_pago
      : "Contado",
    correo_principal: sanitizeEmailInput(form.correo_principal).trim(),
    codigo_pais: form.codigo_pais === "+1" ? "+1" : "+52",
    telefono: sanitizePhoneInput(form.telefono),
    pais: sanitizePersonName(form.pais, 50).trim() || "Mexico",
    estado: sanitizeAddressText(form.estado, 100).trim(),
    ciudad: sanitizeAddressText(form.ciudad, 100).trim(),
    colonia: sanitizeAddressText(form.colonia, 150).trim(),
    calle: sanitizeAddressText(form.calle, 150).trim(),
    numero_exterior: sanitizeAddressText(form.numero_exterior, 50).trim(),
    numero_interior: sanitizeAddressText(form.numero_interior, 50).trim(),
    codigo_postal: sanitizePostalCodeInput(form.codigo_postal),
    agente_cobranza: sanitizePersonName(form.agente_cobranza, 150).trim(),
    dia_corte_individual: sanitizeIntegerInput(form.dia_corte_individual, 2),
    dias_gracia: sanitizeIntegerInput(form.dias_gracia, 3) || "0",
    no_contactar_cobranza_motivo: form.no_contactar_cobranza
      ? sanitizeBusinessText(form.no_contactar_cobranza_motivo, 240).trim()
      : "",
  };

  return applyGenericPublicDefaults(next);
}

function fieldLengthMessage(
  value: string,
  label: string,
  min: number,
  max: number,
  required = true
) {
  const trimmed = value.trim();
  if (!trimmed) {
    return required ? `${label} es obligatorio.` : "";
  }
  if (trimmed.length < min) {
    return `${label} debe tener al menos ${min} caracteres.`;
  }
  if (trimmed.length > max) {
    return `${label} no debe superar ${max} caracteres.`;
  }
  return "";
}

function validateClienteForm(form: ClienteFormState): ClienteFormErrors {
  const errors: ClienteFormErrors = {};
  const genericPublic = isGenericPublicRfc(form.rfc);

  if (!form.entidad_relacionada_id) {
    errors.entidad_relacionada_id = "Selecciona una entidad antes de guardar.";
  }

  if (form.espacio_asignado_id && !isValidDateInput(form.fecha_inicio_asignacion)) {
    errors.fecha_inicio_asignacion =
      "Fecha de inicio de estancia debe tener formato valido.";
  }

  errors.nombre_comercial = fieldLengthMessage(
    form.nombre_comercial,
    "Nombre comercial",
    2,
    200,
    false
  );

  errors.razon_social = fieldLengthMessage(
    form.razon_social,
    form.es_persona_moral ? "Nombre / razon social" : "Nombre completo",
    3,
    250
  );
  if (!errors.razon_social && !form.es_persona_moral && /\d/.test(form.razon_social)) {
    errors.razon_social = "Nombre completo no debe incluir numeros.";
  }
  if (!errors.razon_social && !/[\p{L}]/u.test(form.razon_social)) {
    errors.razon_social = "Nombre / razon social debe incluir texto valido.";
  }

  if (form.rfc.trim() && !genericPublic) {
    const expectedLength = form.es_persona_moral ? 12 : 13;
    if (form.rfc.length !== expectedLength) {
      errors.rfc = `RFC debe tener ${expectedLength} caracteres para ${
        form.es_persona_moral ? "persona moral" : "persona fisica"
      }.`;
    } else if (!/^[A-Z&]{3,4}\d{6}[A-Z0-9]{3}$/.test(form.rfc)) {
      errors.rfc = "RFC debe tener formato fiscal valido, sin espacios ni guiones.";
    }
  }

  if (form.regimen_fiscal.length > 150) {
    errors.regimen_fiscal = "Regimen fiscal no debe superar 150 caracteres.";
  }

  errors.identificador = fieldLengthMessage(
    form.identificador,
    "Identificador interno",
    2,
    100,
    false
  );

  if (!["Contado", "Credito 15 dias", "Credito 30 dias"].includes(form.condiciones_pago)) {
    errors.condiciones_pago = "Selecciona condiciones de pago validas.";
  }

  if (form.correo_principal) {
    if (form.correo_principal.length > 254) {
      errors.correo_principal = "Correo principal no debe superar 254 caracteres.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.correo_principal)) {
      errors.correo_principal = "Correo principal debe tener formato valido.";
    }
  }

  if (!form.telefono) {
    errors.telefono = "Telefono / WhatsApp es obligatorio.";
  } else if (["+52", "+1"].includes(form.codigo_pais) && form.telefono.length !== 10) {
    errors.telefono = "Telefono debe tener 10 digitos para MX o US, sin lada.";
  } else if (form.telefono.length < 8 || form.telefono.length > 15) {
    errors.telefono = "Telefono debe tener entre 8 y 15 digitos.";
  }

  errors.pais = fieldLengthMessage(form.pais, "Pais", 2, 50);
  errors.estado = fieldLengthMessage(form.estado, "Estado", 2, 100, false);
  errors.ciudad = fieldLengthMessage(form.ciudad, "Ciudad", 2, 100, false);
  errors.colonia = fieldLengthMessage(form.colonia, "Colonia", 2, 150, false);
  errors.calle = fieldLengthMessage(form.calle, "Calle", 2, 150, false);
  errors.numero_exterior = fieldLengthMessage(
    form.numero_exterior,
    "Numero exterior",
    1,
    50,
    false
  );
  errors.numero_interior = fieldLengthMessage(
    form.numero_interior,
    "Numero interior",
    1,
    50,
    false
  );

  if (!genericPublic && form.codigo_postal) {
    if (!/^\d{5}$/.test(form.codigo_postal)) {
      errors.codigo_postal = "Codigo postal solo acepta 5 digitos.";
    }
  }

  errors.agente_cobranza = fieldLengthMessage(
    form.agente_cobranza,
    "Agente de cobranza",
    2,
    150,
    false
  );

  if (form.dia_corte_individual) {
    const day = Number(form.dia_corte_individual);
    if (!/^\d+$/.test(form.dia_corte_individual)) {
      errors.dia_corte_individual = "Dia de corte solo acepta numeros enteros.";
    } else if (day < 1 || day > 31) {
      errors.dia_corte_individual = "Dia de corte debe estar entre 1 y 31.";
    }
  }

  const graceDays = Number(form.dias_gracia);
  if (form.dias_gracia === "") {
    errors.dias_gracia = "Dias de gracia es obligatorio.";
  } else if (!/^\d+$/.test(form.dias_gracia)) {
    errors.dias_gracia = "Dias de gracia solo acepta numeros enteros.";
  } else if (graceDays < 0 || graceDays > 365) {
    errors.dias_gracia = "Dias de gracia debe estar entre 0 y 365.";
  }

  if (form.no_contactar_cobranza && !form.no_contactar_cobranza_motivo.trim()) {
    errors.no_contactar_cobranza_motivo =
      "Captura un motivo para bloquear mensajes de cobranza.";
  } else if (form.no_contactar_cobranza_motivo.length > 240) {
    errors.no_contactar_cobranza_motivo =
      "Motivo de bloqueo no debe superar 240 caracteres.";
  }

  Object.keys(errors).forEach((key) => {
    if (!errors[key as keyof ClienteFormState]) {
      delete errors[key as keyof ClienteFormState];
    }
  });

  return errors;
}

function hasValidationErrors(errors: ClienteFormErrors) {
  return Object.values(errors).some(Boolean);
}

function getFirstError(errors: ClienteFormErrors) {
  return Object.values(errors).find(Boolean) || "Revisa los campos marcados.";
}

function getFieldClass(error?: string, disabled = false) {
  return `w-full rounded-md border bg-[#18181b] p-2.5 text-sm text-white outline-none transition focus:ring-1 ${
    error
      ? "border-red-400/60 focus:border-red-400 focus:ring-red-400"
      : "border-zinc-800 focus:border-blue-500 focus:ring-blue-500"
  } ${disabled ? "cursor-not-allowed opacity-60" : ""}`;
}

function InfoButton({
  info,
  onInfo,
}: {
  info: FieldInfo;
  onInfo: (info: FieldInfo) => void;
}) {
  return (
    <button
      type="button"
      title={info.title}
      aria-label={`Informacion: ${info.title}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onInfo(info);
      }}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-400/10 text-[11px] font-semibold text-cyan-200 transition hover:border-cyan-300/70 hover:bg-cyan-400/20"
    >
      i
    </button>
  );
}

function FieldInfoModal({
  info,
  onClose,
}: {
  info: FieldInfo | null;
  onClose: () => void;
}) {
  if (!info) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-field-info-title"
        className="w-full max-w-lg rounded-2xl border border-cyan-500/20 bg-zinc-950 p-5 shadow-2xl shadow-black/60"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">
              Detalle del campo
            </p>
            <h3
              id="client-field-info-title"
              className="mt-2 text-xl font-semibold text-white"
            >
              {info.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-zinc-300 transition hover:bg-white/10"
          >
            Cerrar
          </button>
        </div>
        <p className="mt-4 text-sm leading-6 text-zinc-300">{info.body}</p>
        {info.details?.length ? (
          <ul className="mt-4 space-y-2 text-sm leading-6 text-zinc-400">
            {info.details.map((detail) => (
              <li
                key={detail}
                className="rounded-2xl border border-white/8 bg-zinc-900/70 px-4 py-3"
              >
                {detail}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function FieldLabel({
  label,
  required,
  info,
  onInfo,
}: {
  label: string;
  required?: boolean;
  info: FieldInfo;
  onInfo: (info: FieldInfo) => void;
}) {
  return (
    <label className="mb-1.5 flex min-h-7 flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
      <span>{label}</span>
      <span className={required ? "text-cyan-200" : "text-zinc-600"}>
        {required ? "Obligatorio" : "Opcional"}
      </span>
      <InfoButton info={info} onInfo={onInfo} />
    </label>
  );
}

function FieldFeedback({
  error,
  helper,
}: {
  error?: string;
  helper?: string;
}) {
  if (!error && !helper) return null;

  return (
    <p className={`mt-2 text-xs leading-5 ${error ? "text-rose-200" : "text-zinc-500"}`}>
      {error || helper}
    </p>
  );
}

export default function ClienteFormModal({
  isOpen,
  mode,
  cliente,
  entityOptions,
  onClose,
  onSuccess,
}: ClienteFormModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [formError, setFormError] = useState("");
  const [formErrors, setFormErrors] = useState<ClienteFormErrors>({});
  const [fieldInfo, setFieldInfo] = useState<FieldInfo | null>(null);
  const [openSection, setOpenSection] = useState({
    fiscales: true,
    contacto: true,
    configuracion: true,
  });
  const [formData, setFormData] = useState<ClienteFormState>(() =>
    buildInitialForm(entityOptions, cliente, mode)
  );
  const [availableSpaces, setAvailableSpaces] = useState<EspacioDisponibleOption[]>(
    []
  );
  const [isLoadingSpaces, setIsLoadingSpaces] = useState(false);
  const [spacesError, setSpacesError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setFormError("");
    setFormErrors({});
    setFieldInfo(null);
    setOpenSection({
      fiscales: true,
      contacto: true,
      configuracion: true,
    });
    setFormData(buildInitialForm(entityOptions, cliente, mode));
    setAvailableSpaces([]);
    setSpacesError("");
  }, [cliente, entityOptions, isOpen, mode]);

  useEffect(() => {
    if (!isOpen || !formData.entidad_relacionada_id) {
      setAvailableSpaces([]);
      setSpacesError("");
      setIsLoadingSpaces(false);
      return;
    }

    let isCancelled = false;
    setIsLoadingSpaces(true);
    setSpacesError("");

    fetch(`${ESPACIOS_API_BASE}/entidades/${formData.entidad_relacionada_id}/lista/`)
      .then(async (response) => {
        const body = await response.json().catch(() => []);
        if (!response.ok) {
          throw new Error(
            typeof body === "object" && body && "detail" in body
              ? String(body.detail)
              : "No se pudieron cargar las habitaciones disponibles."
          );
        }
        return body as EspacioDisponibleOption[];
      })
      .then((spaces) => {
        if (isCancelled) {
          return;
        }
        setAvailableSpaces(
          spaces.filter(
            (space) =>
              space.estatus === "DISPONIBLE" &&
              !space.asignacion_activa_id &&
              !space.cliente_actual_id
          )
        );
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        setAvailableSpaces([]);
        setSpacesError(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar las habitaciones disponibles."
        );
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingSpaces(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [formData.entidad_relacionada_id, isOpen]);

  useEffect(() => {
    if (!formData.espacio_asignado_id || isLoadingSpaces) {
      return;
    }
    if (!availableSpaces.some((space) => space.id === formData.espacio_asignado_id)) {
      setFormData((prev) => ({ ...prev, espacio_asignado_id: 0 }));
    }
  }, [availableSpaces, formData.espacio_asignado_id, isLoadingSpaces]);

  if (!isOpen) {
    return null;
  }

  const copy = getModalCopy(mode);
  const isGenericPublic = isGenericPublicRfc(formData.rfc);
  const fiscalRegimeOptions = getFiscalRegimeOptions(
    isGenericPublic ? false : formData.es_persona_moral
  );

  const toggleSection = (section: keyof typeof openSection) => {
    setOpenSection((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const updateField = <K extends keyof ClienteFormState>(
    key: K,
    value: ClienteFormState[K]
  ) => {
    setFormError("");
    setFormData((prev) => ({ ...prev, [key]: value }));
    setFormErrors((prev) => {
      if (!prev[key]) {
        return prev;
      }
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleEntityChange = (entityId: number) => {
    setFormError("");
    setFormData((prev) => ({
      ...prev,
      entidad_relacionada_id: entityId,
      espacio_asignado_id: 0,
      fecha_inicio_asignacion: prev.fecha_inicio_asignacion || todayLocalDate(),
    }));
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next.entidad_relacionada_id;
      delete next.espacio_asignado_id;
      delete next.fecha_inicio_asignacion;
      return next;
    });
    setSpacesError("");
  };

  const handleRfcChange = (value: string) => {
    setFormError("");
    setFormData((prev) =>
      applyGenericPublicDefaults({
        ...prev,
        rfc: sanitizeRfcInput(value),
      })
    );
    setFormErrors((prev) => {
      if (!prev.rfc && !prev.razon_social && !prev.regimen_fiscal && !prev.codigo_postal) {
        return prev;
      }
      const next = { ...prev };
      delete next.rfc;
      delete next.razon_social;
      delete next.regimen_fiscal;
      delete next.codigo_postal;
      return next;
    });
  };

  const handlePersonTypeChange = (isPersonaMoral: boolean) => {
    setFormError("");
    setFormData((prev) => {
      if (isGenericPublicRfc(prev.rfc)) {
        return applyGenericPublicDefaults(prev);
      }
      return {
        ...prev,
        es_persona_moral: isPersonaMoral,
        regimen_fiscal: normalizeFiscalRegimeValue(
          prev.regimen_fiscal,
          isPersonaMoral
        ),
      };
    });
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next.es_persona_moral;
      delete next.razon_social;
      delete next.rfc;
      delete next.regimen_fiscal;
      return next;
    });
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (file.type !== "application/pdf") {
      setFormError("Solo se admite la Constancia de Situacion Fiscal en PDF.");
      return;
    }

    setIsExtracting(true);
    setFormError("");
    const requestData = new FormData();
    requestData.append("file", file);

    try {
      const response = await fetch(`${CRM_API_BASE}/extraer-csf/`, {
        method: "POST",
        body: requestData,
      });
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        datos_extraidos?: ExtractedCsfData;
      };

      if (!response.ok) {
        throw new Error(body.detail || "No se pudo procesar la CSF.");
      }

      const extracted = body.datos_extraidos || {};
      setFormData((prev) => {
        const nextIsMoral =
          extracted.es_persona_moral !== undefined
            ? extracted.es_persona_moral
            : prev.es_persona_moral;
        return normalizeClienteForm({
          ...prev,
          es_persona_moral: nextIsMoral,
          regimen_fiscal:
            normalizeFiscalRegimeValue(
              extracted.regimen_fiscal || prev.regimen_fiscal,
              nextIsMoral
            ) || "",
          nombre_comercial: extracted.nombre_comercial || prev.nombre_comercial,
          razon_social: extracted.razon_social || prev.razon_social,
          rfc: extracted.rfc || prev.rfc,
          archivo_csf_url: extracted.archivo_csf_url || prev.archivo_csf_url,
          correo_principal: extracted.correo_principal || prev.correo_principal,
          estado: extracted.estado || prev.estado,
          ciudad: extracted.ciudad || prev.ciudad,
          colonia: extracted.colonia || prev.colonia,
          calle: extracted.calle || prev.calle,
          numero_exterior: extracted.numero_exterior || prev.numero_exterior,
          numero_interior: extracted.numero_interior || prev.numero_interior,
          codigo_postal: extracted.codigo_postal || prev.codigo_postal,
        });
      });
      setFormErrors({});
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Error de red al extraer datos de la CSF."
      );
    } finally {
      setIsExtracting(false);
      event.target.value = "";
    }
  };

  const handleSubmit = async () => {
    const normalizedFormData = normalizeClienteForm(formData);
    const validationErrors = validateClienteForm(normalizedFormData);

    setFormData(normalizedFormData);
    setFormErrors(validationErrors);

    if (hasValidationErrors(validationErrors)) {
      setFormError(getFirstError(validationErrors));
      return;
    }

    setIsLoading(true);
    setFormError("");
    setFormErrors({});

    const payload = {
      entidad_relacionada_id: normalizedFormData.entidad_relacionada_id,
      es_persona_moral: normalizedFormData.es_persona_moral,
      nombre_comercial: normalizedFormData.nombre_comercial,
      razon_social: normalizedFormData.razon_social,
      rfc: normalizedFormData.rfc,
      regimen_fiscal: normalizedFormData.regimen_fiscal,
      identificador: normalizedFormData.identificador,
      condiciones_pago: normalizedFormData.condiciones_pago,
      archivo_csf_url: normalizedFormData.archivo_csf_url,
      correo_principal: normalizedFormData.correo_principal,
      codigo_pais: normalizedFormData.codigo_pais,
      telefono: normalizedFormData.telefono,
      pais: normalizedFormData.pais,
      estado: normalizedFormData.estado,
      ciudad: normalizedFormData.ciudad,
      colonia: normalizedFormData.colonia,
      calle: normalizedFormData.calle,
      numero_exterior: normalizedFormData.numero_exterior,
      numero_interior: normalizedFormData.numero_interior,
      codigo_postal: normalizedFormData.codigo_postal,
      agente_cobranza: normalizedFormData.agente_cobranza,
      dia_corte_individual: normalizedFormData.dia_corte_individual
        ? Number(normalizedFormData.dia_corte_individual)
        : null,
      dias_gracia: Number(normalizedFormData.dias_gracia || "0"),
      no_contactar_cobranza: normalizedFormData.no_contactar_cobranza,
      no_contactar_cobranza_motivo:
        normalizedFormData.no_contactar_cobranza_motivo,
      activo: normalizedFormData.activo,
    };

    const url =
      mode === "edit" && cliente
        ? `${CRM_API_BASE}/cliente/${cliente.id}/`
        : `${CRM_API_BASE}/crear/`;
    const method = mode === "edit" ? "PUT" : "POST";

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
        id?: number;
      };

      if (!response.ok) {
        throw new Error(body.detail || "No se pudo guardar el cliente.");
      }

      if (normalizedFormData.espacio_asignado_id) {
        const savedClienteId =
          mode === "edit" && cliente ? cliente.id : body.id;

        if (!savedClienteId) {
          throw new Error(
            "Cliente guardado, pero no se pudo identificar para asignar el espacio."
          );
        }

        const assignmentResponse = await fetch(
          `${ESPACIOS_API_BASE}/espacios/${normalizedFormData.espacio_asignado_id}/asignar/`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cliente_id: savedClienteId,
              fecha_inicio: normalizedFormData.fecha_inicio_asignacion,
            }),
          }
        );
        const assignmentBody = (await assignmentResponse
          .json()
          .catch(() => ({}))) as { detail?: string; mensaje?: string };

        if (!assignmentResponse.ok) {
          throw new Error(
            assignmentBody.detail ||
              "Cliente guardado, pero no se pudo asignar la habitacion."
          );
        }

        body.mensaje = `${body.mensaje || copy.successMessage} ${
          assignmentBody.mensaje || "Habitacion asignada correctamente."
        }`;
      }

      onClose();
      onSuccess?.(body.mensaje || copy.successMessage);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Error de red al comunicarse con el servidor."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const entityLabel =
    entityOptions.find((option) => option.id === formData.entidad_relacionada_id)
      ?.nombre || "Sin entidad";

  return (
    <>
      <FieldInfoModal info={fieldInfo} onClose={() => setFieldInfo(null)} />
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl border border-zinc-800 bg-[#0a0a0a] shadow-2xl">
        <div className="flex items-center justify-between rounded-t-xl border-b border-zinc-800 bg-[#121212] px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="text-zinc-400 transition-colors hover:text-white"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
            <div>
              <h2 className="text-xl font-bold text-white">{copy.title}</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Entidad actual: <span className="text-zinc-300">{entityLabel}</span>
              </p>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={isLoading || isExtracting}
            className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-semibold tracking-wide text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {isLoading ? "GUARDANDO..." : copy.submitLabel}
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {formError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {formError}
            </div>
          )}

          <section className="overflow-hidden rounded-xl border border-zinc-800/80 bg-[#121212]">
            <button
              onClick={() => toggleSection("fiscales")}
              className="flex w-full items-center justify-between bg-zinc-900/50 p-4 text-left transition-colors hover:bg-zinc-800/50"
            >
              <h3 className="text-[15px] font-semibold text-blue-400">
                Datos fiscales
              </h3>
              <svg
                className={`h-5 w-5 transform text-zinc-500 transition-transform ${
                  openSection.fiscales ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {openSection.fiscales && (
              <div className="space-y-5 border-t border-zinc-800/80 p-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel
                      label="Entidad relacionada"
                      required
                      info={CLIENT_FIELD_INFO.entidad_relacionada_id}
                      onInfo={setFieldInfo}
                    />
                    <select
                      value={formData.entidad_relacionada_id}
                      onChange={(event) =>
                        handleEntityChange(Number(event.target.value))
                      }
                      className={getFieldClass(formErrors.entidad_relacionada_id)}
                    >
                      <option value={0}>Selecciona una entidad</option>
                      {entityOptions.map((entity) => (
                        <option key={entity.id} value={entity.id}>
                          {entity.nombre}
                        </option>
                      ))}
                    </select>
                    <FieldFeedback error={formErrors.entidad_relacionada_id} />
                  </div>

                  <div>
                    <FieldLabel
                      label="Habitacion disponible"
                      info={CLIENT_FIELD_INFO.espacio_asignado_id}
                      onInfo={setFieldInfo}
                    />
                    <select
                      value={formData.espacio_asignado_id}
                      onChange={(event) =>
                        updateField(
                          "espacio_asignado_id",
                          Number(event.target.value)
                        )
                      }
                      disabled={
                        !formData.entidad_relacionada_id ||
                        isLoadingSpaces ||
                        availableSpaces.length === 0
                      }
                      className={getFieldClass(
                        formErrors.espacio_asignado_id,
                        !formData.entidad_relacionada_id ||
                          isLoadingSpaces ||
                          availableSpaces.length === 0
                      )}
                    >
                      <option value={0}>
                        {!formData.entidad_relacionada_id
                          ? "Selecciona primero una entidad"
                          : isLoadingSpaces
                            ? "Cargando habitaciones..."
                            : availableSpaces.length === 0
                              ? "Sin habitaciones disponibles"
                              : "Sin asignar habitacion"}
                      </option>
                      {availableSpaces.map((space) => (
                        <option key={space.id} value={space.id}>
                          {space.codigo}
                          {space.tipo_nombre ? ` | ${space.tipo_nombre}` : ""}
                          {space.renta_sugerida
                            ? ` | ${formatCurrency(space.renta_sugerida)}`
                            : ""}
                        </option>
                      ))}
                    </select>
                    {spacesError ? (
                      <p className="mt-1 text-xs text-red-300">{spacesError}</p>
                    ) : formData.entidad_relacionada_id &&
                      !isLoadingSpaces &&
                      availableSpaces.length === 0 ? (
                      <p className="mt-1 text-xs text-zinc-500">
                        No hay habitaciones libres para esta entidad.
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-zinc-500">
                        Solo aparecen habitaciones sin asignacion activa.
                      </p>
                    )}
                    <FieldFeedback error={formErrors.espacio_asignado_id} />
                    <div className="mt-4">
                      <FieldLabel
                        label="Fecha inicio de renta"
                        required={Boolean(formData.espacio_asignado_id)}
                        info={CLIENT_FIELD_INFO.fecha_inicio_asignacion}
                        onInfo={setFieldInfo}
                      />
                      <input
                        type="date"
                        value={formData.fecha_inicio_asignacion}
                        disabled={!formData.espacio_asignado_id}
                        onChange={(event) =>
                          updateField(
                            "fecha_inicio_asignacion",
                            sanitizeDateInput(event.target.value)
                          )
                        }
                        className={getFieldClass(
                          formErrors.fecha_inicio_asignacion,
                          !formData.espacio_asignado_id
                        )}
                      />
                      <FieldFeedback
                        error={formErrors.fecha_inicio_asignacion}
                        helper={
                          formData.espacio_asignado_id
                            ? "Por default se usa hoy; ajustalo si la renta inicia antes o despues."
                            : "Selecciona una habitacion para activar la fecha de inicio."
                        }
                      />
                    </div>
                  </div>

                  <div className="rounded-md border border-zinc-800 bg-[#18181b] p-3 md:col-span-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-300">
                          Tipo de persona fiscal
                        </span>
                        <InfoButton
                          info={CLIENT_FIELD_INFO.es_persona_moral}
                          onInfo={setFieldInfo}
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`text-xs ${
                            !formData.es_persona_moral
                              ? "font-semibold text-blue-400"
                              : "text-zinc-500"
                          }`}
                        >
                          Fisica
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handlePersonTypeChange(!formData.es_persona_moral)
                          }
                          disabled={isGenericPublic}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            formData.es_persona_moral
                              ? "bg-blue-600"
                              : "bg-zinc-600"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              formData.es_persona_moral
                                ? "translate-x-6"
                                : "translate-x-1"
                            }`}
                          />
                        </button>
                        <span
                          className={`text-xs ${
                            formData.es_persona_moral
                              ? "font-semibold text-blue-400"
                              : "text-zinc-500"
                          }`}
                        >
                          Moral
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="relative rounded-lg border border-dashed border-zinc-700 bg-[#0a0a0a] p-6 text-center transition-colors hover:border-blue-500">
                  <div className="absolute left-4 top-4 z-20">
                    <InfoButton
                      info={CLIENT_FIELD_INFO.archivo_csf_url}
                      onInfo={setFieldInfo}
                    />
                  </div>
                  {isExtracting ? (
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                      <p className="text-sm font-medium text-blue-400">
                        Procesando constancia...
                      </p>
                    </div>
                  ) : formData.archivo_csf_url ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-emerald-400">
                        Constancia procesada y vinculada
                      </p>
                      <a
                        href={formData.archivo_csf_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-cyan-300 underline underline-offset-2"
                      >
                        Abrir archivo actual
                      </a>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm text-zinc-300">
                        Carga la Constancia de Situacion Fiscal para autocompletar
                        los datos.
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        Formato valido: PDF
                      </p>
                    </div>
                  )}
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={handleFileUpload}
                    disabled={isExtracting}
                    className="absolute inset-0 z-0 h-full w-full cursor-pointer opacity-0"
                  />
                </div>

                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-50/80">
                  Puedes registrar clientes para cobranza sin RFC, regimen fiscal ni codigo postal.
                  Si el cliente solicita factura, podra completar esos datos desde su portal de autoservicio.
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel
                      label="Nombre comercial"
                      info={CLIENT_FIELD_INFO.nombre_comercial}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      maxLength={200}
                      placeholder="Ej. Daniel Lopez / Empresa ABC"
                      value={formData.nombre_comercial}
                      onChange={(event) =>
                        updateField(
                          "nombre_comercial",
                          sanitizeBusinessText(event.target.value, 200)
                        )
                      }
                      className={getFieldClass(formErrors.nombre_comercial)}
                    />
                    <FieldFeedback
                      error={formErrors.nombre_comercial}
                      helper="Maximo 200 caracteres; puede ser distinto al receptor fiscal."
                    />
                  </div>

                  <div>
                    <FieldLabel
                      label={formData.es_persona_moral ? "Nombre / razon social" : "Nombre completo"}
                      required
                      info={CLIENT_FIELD_INFO.razon_social}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      maxLength={250}
                      placeholder={
                        formData.es_persona_moral
                          ? "Ej. Operadora del Centro SA de CV"
                          : "Ej. Daniel Lopez Perez"
                      }
                      value={formData.razon_social}
                      onChange={(event) =>
                        updateField(
                          "razon_social",
                          formData.es_persona_moral
                            ? sanitizeBusinessText(event.target.value, 250)
                            : sanitizePersonName(event.target.value, 250)
                        )
                      }
                      disabled={isGenericPublic}
                      className={getFieldClass(formErrors.razon_social, isGenericPublic)}
                    />
                    <FieldFeedback
                      error={formErrors.razon_social}
                      helper={
                        formData.es_persona_moral
                          ? "Entre 3 y 250 caracteres, conforme a la CSF."
                          : "Solo letras, espacios, apostrofe y guion."
                      }
                    />
                  </div>

                  <div>
                    <FieldLabel
                      label="RFC"
                      info={CLIENT_FIELD_INFO.rfc}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      maxLength={13}
                      placeholder={formData.es_persona_moral ? "ABC010101AB1" : "LOPD900101AB1"}
                      value={formData.rfc}
                      onChange={(event) => handleRfcChange(event.target.value)}
                      className={`${getFieldClass(formErrors.rfc)} uppercase`}
                    />
                    <FieldFeedback
                      error={formErrors.rfc}
                      helper={
                        formData.es_persona_moral
                          ? "Opcional para cobranza; persona moral usa 12 caracteres si factura."
                          : "Opcional para cobranza; persona fisica usa 13 caracteres si factura."
                      }
                    />
                  </div>

                  <div>
                    <FieldLabel
                      label="Regimen fiscal"
                      info={CLIENT_FIELD_INFO.regimen_fiscal}
                      onInfo={setFieldInfo}
                    />
                    <select
                      value={formData.regimen_fiscal}
                      onChange={(event) =>
                        updateField("regimen_fiscal", event.target.value)
                      }
                      disabled={isGenericPublic}
                      className={getFieldClass(formErrors.regimen_fiscal, isGenericPublic)}
                    >
                      <option value="">Selecciona regimen fiscal</option>
                      {fiscalRegimeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <FieldFeedback
                      error={formErrors.regimen_fiscal}
                      helper="Opcional para cobranza; requerido cuando el cliente solicite factura."
                    />
                  </div>

                  <div>
                    <FieldLabel
                      label="Identificador interno"
                      info={CLIENT_FIELD_INFO.identificador}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      maxLength={100}
                      placeholder="Ej. CONTRATO-001"
                      value={formData.identificador}
                      onChange={(event) =>
                        updateField("identificador", sanitizeIdentifier(event.target.value))
                      }
                      className={getFieldClass(formErrors.identificador)}
                    />
                    <FieldFeedback
                      error={formErrors.identificador}
                      helper="Opcional para folios, contratos o referencias internas."
                    />
                  </div>

                  <div>
                    <FieldLabel
                      label="Condiciones pago"
                      required
                      info={CLIENT_FIELD_INFO.condiciones_pago}
                      onInfo={setFieldInfo}
                    />
                    <select
                      value={formData.condiciones_pago}
                      onChange={(event) =>
                        updateField("condiciones_pago", event.target.value)
                      }
                      className={getFieldClass(formErrors.condiciones_pago)}
                    >
                      <option value="Contado">Contado</option>
                      <option value="Credito 15 dias">Credito 15 dias</option>
                      <option value="Credito 30 dias">Credito 30 dias</option>
                    </select>
                    <FieldFeedback error={formErrors.condiciones_pago} />
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-zinc-800/80 bg-[#121212]">
            <button
              onClick={() => toggleSection("contacto")}
              className="flex w-full items-center justify-between bg-zinc-900/50 p-4 text-left transition-colors hover:bg-zinc-800/50"
            >
              <h3 className="text-[15px] font-semibold text-blue-400">
                Contacto y direccion
              </h3>
              <svg
                className={`h-5 w-5 transform text-zinc-500 transition-transform ${
                  openSection.contacto ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {openSection.contacto && (
              <div className="space-y-4 border-t border-zinc-800/80 p-5">
                <div>
                  <FieldLabel
                    label="Correo principal"
                    info={CLIENT_FIELD_INFO.correo_principal}
                    onInfo={setFieldInfo}
                  />
                  <input
                    type="email"
                    maxLength={254}
                    placeholder="cliente@correo.com"
                    value={formData.correo_principal}
                    onChange={(event) =>
                      updateField(
                        "correo_principal",
                        sanitizeEmailInput(event.target.value)
                      )
                    }
                    className={getFieldClass(formErrors.correo_principal)}
                  />
                  <FieldFeedback
                    error={formErrors.correo_principal}
                    helper="Opcional; si se captura debe tener formato de correo valido."
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
                  <div>
                    <FieldLabel
                      label="Codigo pais"
                      required
                      info={CLIENT_FIELD_INFO.codigo_pais}
                      onInfo={setFieldInfo}
                    />
                    <select
                      value={formData.codigo_pais}
                      onChange={(event) =>
                        updateField("codigo_pais", event.target.value)
                      }
                      className={getFieldClass(formErrors.codigo_pais)}
                    >
                      <option value="+52">MX (+52)</option>
                      <option value="+1">US (+1)</option>
                    </select>
                    <FieldFeedback error={formErrors.codigo_pais} />
                  </div>
                  <div>
                    <FieldLabel
                      label="Telefono / WhatsApp"
                      required
                      info={CLIENT_FIELD_INFO.telefono}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="10 digitos"
                      value={formData.telefono}
                      onChange={(event) =>
                        updateField("telefono", sanitizePhoneInput(event.target.value))
                      }
                      className={getFieldClass(formErrors.telefono)}
                    />
                    <FieldFeedback
                      error={formErrors.telefono}
                      helper="Solo digitos; captura el numero sin lada."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel
                      label="Pais"
                      required
                      info={CLIENT_FIELD_INFO.pais}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      maxLength={50}
                      placeholder="Mexico"
                      value={formData.pais}
                      onChange={(event) =>
                        updateField("pais", sanitizePersonName(event.target.value, 50))
                      }
                      className={getFieldClass(formErrors.pais)}
                    />
                    <FieldFeedback error={formErrors.pais} />
                  </div>
                  <div>
                    <FieldLabel
                      label="Estado"
                      info={CLIENT_FIELD_INFO.estado}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      maxLength={100}
                      placeholder="Ej. Ciudad de Mexico"
                      value={formData.estado}
                      onChange={(event) =>
                        updateField("estado", sanitizeAddressText(event.target.value, 100))
                      }
                      className={getFieldClass(formErrors.estado)}
                    />
                    <FieldFeedback error={formErrors.estado} />
                  </div>
                  <div>
                    <FieldLabel
                      label="Ciudad"
                      info={CLIENT_FIELD_INFO.ciudad}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      maxLength={100}
                      placeholder="Ej. Benito Juarez"
                      value={formData.ciudad}
                      onChange={(event) =>
                        updateField("ciudad", sanitizeAddressText(event.target.value, 100))
                      }
                      className={getFieldClass(formErrors.ciudad)}
                    />
                    <FieldFeedback error={formErrors.ciudad} />
                  </div>
                  <div>
                    <FieldLabel
                      label="Colonia"
                      info={CLIENT_FIELD_INFO.colonia}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      maxLength={150}
                      placeholder="Ej. Del Valle"
                      value={formData.colonia}
                      onChange={(event) =>
                        updateField("colonia", sanitizeAddressText(event.target.value, 150))
                      }
                      className={getFieldClass(formErrors.colonia)}
                    />
                    <FieldFeedback error={formErrors.colonia} />
                  </div>
                  <div>
                    <FieldLabel
                      label="Calle"
                      info={CLIENT_FIELD_INFO.calle}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      maxLength={150}
                      placeholder="Ej. Insurgentes Sur"
                      value={formData.calle}
                      onChange={(event) =>
                        updateField("calle", sanitizeAddressText(event.target.value, 150))
                      }
                      className={getFieldClass(formErrors.calle)}
                    />
                    <FieldFeedback error={formErrors.calle} />
                  </div>
                  {isGenericPublic ? (
                    <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-sm text-emerald-100/80">
                      RFC generico: no se captura CP del receptor. Al timbrar se
                      usara el CP del lugar de expedicion del emisor.
                    </div>
                  ) : (
                    <div>
                      <FieldLabel
                        label="Codigo postal"
                        info={CLIENT_FIELD_INFO.codigo_postal}
                        onInfo={setFieldInfo}
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={5}
                        placeholder="5 digitos"
                        value={formData.codigo_postal}
                        onChange={(event) =>
                          updateField(
                            "codigo_postal",
                            sanitizePostalCodeInput(event.target.value)
                          )
                        }
                        className={getFieldClass(formErrors.codigo_postal)}
                      />
                      <FieldFeedback
                        error={formErrors.codigo_postal}
                        helper="Opcional para cobranza; debe coincidir con la CSF si se factura."
                      />
                    </div>
                  )}
                  <div>
                    <FieldLabel
                      label="Numero exterior"
                      info={CLIENT_FIELD_INFO.numero_exterior}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      maxLength={50}
                      placeholder="Ej. 123"
                      value={formData.numero_exterior}
                      onChange={(event) =>
                        updateField(
                          "numero_exterior",
                          sanitizeAddressText(event.target.value, 50)
                        )
                      }
                      className={getFieldClass(formErrors.numero_exterior)}
                    />
                    <FieldFeedback error={formErrors.numero_exterior} />
                  </div>
                  <div>
                    <FieldLabel
                      label="Numero interior"
                      info={CLIENT_FIELD_INFO.numero_interior}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      maxLength={50}
                      placeholder="Ej. Depto 4B"
                      value={formData.numero_interior}
                      onChange={(event) =>
                        updateField(
                          "numero_interior",
                          sanitizeAddressText(event.target.value, 50)
                        )
                      }
                      className={getFieldClass(formErrors.numero_interior)}
                    />
                    <FieldFeedback error={formErrors.numero_interior} />
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-zinc-800/80 bg-[#121212]">
            <button
              onClick={() => toggleSection("configuracion")}
              className="flex w-full items-center justify-between bg-zinc-900/50 p-4 text-left transition-colors hover:bg-zinc-800/50"
            >
              <h3 className="text-[15px] font-semibold text-blue-400">
                Configuracion interna
              </h3>
              <svg
                className={`h-5 w-5 transform text-zinc-500 transition-transform ${
                  openSection.configuracion ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {openSection.configuracion && (
              <div className="space-y-4 border-t border-zinc-800/80 p-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel
                      label="Agente de cobranza"
                      info={CLIENT_FIELD_INFO.agente_cobranza}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      maxLength={150}
                      placeholder="Ej. Equipo cobranza"
                      value={formData.agente_cobranza}
                      onChange={(event) =>
                        updateField(
                          "agente_cobranza",
                          sanitizePersonName(event.target.value, 150)
                        )
                      }
                      className={getFieldClass(formErrors.agente_cobranza)}
                    />
                    <FieldFeedback error={formErrors.agente_cobranza} />
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-[#18181b] p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-300">
                          Cliente activo
                        </span>
                        <InfoButton
                          info={CLIENT_FIELD_INFO.activo}
                          onInfo={setFieldInfo}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => updateField("activo", !formData.activo)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          formData.activo ? "bg-emerald-600" : "bg-zinc-600"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            formData.activo ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                  <div
                    className={`rounded-md border p-3 ${
                      formData.no_contactar_cobranza
                        ? "border-amber-400/30 bg-amber-500/10"
                        : "border-zinc-800 bg-[#18181b]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-300">
                          No contactar para cobranza
                        </span>
                        <InfoButton
                          info={CLIENT_FIELD_INFO.no_contactar_cobranza}
                          onInfo={setFieldInfo}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const nextValue = !formData.no_contactar_cobranza;
                          updateField("no_contactar_cobranza", nextValue);
                          if (!nextValue) {
                            updateField("no_contactar_cobranza_motivo", "");
                          }
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          formData.no_contactar_cobranza
                            ? "bg-amber-500"
                            : "bg-zinc-600"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            formData.no_contactar_cobranza
                              ? "translate-x-6"
                              : "translate-x-1"
                          }`}
                        />
                      </button>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      Bloquea avisos de cobranza sin afectar portal, pagos ni facturacion.
                    </p>
                  </div>
                  {formData.no_contactar_cobranza ? (
                    <div className="md:col-span-2">
                      <FieldLabel
                        label="Motivo de no contacto"
                        required
                        info={CLIENT_FIELD_INFO.no_contactar_cobranza_motivo}
                        onInfo={setFieldInfo}
                      />
                      <textarea
                        maxLength={240}
                        rows={3}
                        placeholder="Ej. Cliente solicito no recibir mensajes de cobranza por WhatsApp."
                        value={formData.no_contactar_cobranza_motivo}
                        onChange={(event) =>
                          updateField(
                            "no_contactar_cobranza_motivo",
                            sanitizeBusinessText(event.target.value, 240)
                          )
                        }
                        className={getFieldClass(
                          formErrors.no_contactar_cobranza_motivo
                        )}
                      />
                      <FieldFeedback
                        error={formErrors.no_contactar_cobranza_motivo}
                        helper={`${formData.no_contactar_cobranza_motivo.length}/240 caracteres.`}
                      />
                    </div>
                  ) : null}
                  <div>
                    <FieldLabel
                      label="Dia de corte individual"
                      info={CLIENT_FIELD_INFO.dia_corte_individual}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={2}
                      placeholder="1 a 31"
                      value={formData.dia_corte_individual}
                      onChange={(event) =>
                        updateField(
                          "dia_corte_individual",
                          sanitizeIntegerInput(event.target.value, 2)
                        )
                      }
                      className={getFieldClass(formErrors.dia_corte_individual)}
                    />
                    <FieldFeedback
                      error={formErrors.dia_corte_individual}
                      helper="Opcional; dejalo vacio para heredar el corte de la entidad."
                    />
                  </div>
                  <div>
                    <FieldLabel
                      label="Dias de gracia"
                      required
                      info={CLIENT_FIELD_INFO.dias_gracia}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={3}
                      placeholder="0 a 365"
                      value={formData.dias_gracia}
                      onChange={(event) =>
                        updateField(
                          "dias_gracia",
                          sanitizeIntegerInput(event.target.value, 3)
                        )
                      }
                      className={getFieldClass(formErrors.dias_gracia)}
                    />
                    <FieldFeedback
                      error={formErrors.dias_gracia}
                      helper="Solo numeros enteros; usa 0 si no hay tolerancia."
                    />
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
      </div>
    </>
  );
}
