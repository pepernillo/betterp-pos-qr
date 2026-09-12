"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { buildApiUrl } from "@/lib/api";

interface PortalCuenta {
  id: number;
  espacio_codigo?: string | null;
  concepto: string;
  fecha_vencimiento: string;
  fecha_limite_gracia: string;
  monto_base: number;
  interes_monto: number;
  total_a_pagar: number;
  categoria_tablero: string;
  factura?: PortalFactura | null;
}

interface PortalPago {
  id: number;
  concepto: string;
  monto: number;
  fecha_pago: string;
  metodo: string;
  referencia?: string | null;
}

interface PortalFactura {
  id: number;
  estatus: string;
  serie?: string | null;
  folio?: string | null;
  uuid?: string | null;
  proveedor_factura_id?: string | null;
  total: number;
  fecha_emision?: string | null;
  fecha_timbrado?: string | null;
  pdf_url?: string | null;
  xml_url?: string | null;
  error_proveedor?: string | null;
}

interface FiscalRegimeOption {
  codigo?: string | null;
  descripcion?: string | null;
  label?: string | null;
}

interface PortalComprobante {
  id: number;
  cuenta_id?: number | string | null;
  archivo_nombre?: string | null;
  monto_reportado?: number | null;
  fecha_pago_reportada?: string | null;
  referencia_reportada?: string | null;
  estatus: string;
  requiere_revision_manual: boolean;
  fecha_registro: string;
  mensaje: string;
}

interface PortalBehavior {
  pagadas_a_tiempo: number;
  pagadas_en_gracia: number;
  pagadas_tarde: number;
  abiertas_por_vencer: number;
  abiertas_en_gracia: number;
  abiertas_vencidas: number;
}

interface PortalTrend {
  periodo?: string | null;
  label: string;
  facturado: number;
  pagado: number;
  pendiente: number;
}

interface PortalAuthState {
  required: boolean;
  verified: boolean;
  channel: string;
  masked_phone?: string | null;
  can_request_code: boolean;
  resend_seconds: number;
  code_expires_minutes: number;
  session_hours: number;
  detail?: string | null;
}

interface PortalPayload {
  cliente: {
    id: number | null;
    nombre: string;
    rfc?: string | null;
    entidad_nombre: string;
    correo?: string | null;
    telefono?: string | null;
  };
  resumen: {
    saldo_vivo: number;
    recargos_activos: number;
    total_pagado: number;
    total_facturado: number;
    score_pago: number;
    score_label: string;
    cuentas_totales: number;
    cuentas_vencidas_abiertas: number;
    cuentas_en_gracia: number;
    puntualidad_porcentaje?: number;
    morosidad_porcentaje?: number;
  };
  comportamiento?: PortalBehavior;
  tendencia_periodos?: PortalTrend[];
  cuentas: PortalCuenta[];
  pagos_recientes: PortalPago[];
  facturas_recientes: PortalFactura[];
  comprobantes_recientes?: PortalComprobante[];
  consentimiento_cobranza?: {
    requerido: boolean;
    aceptado: boolean;
    version: string;
    titulo: string;
    texto: string;
    texto_hash: string;
    requerimientos: string[];
    fecha_aceptacion?: string | null;
  };
  transferencia: {
    beneficiario?: string | null;
    banco?: string | null;
    clabe?: string | null;
    referencia?: string | null;
  };
  facturacion: {
    activa: boolean;
    pac_proveedor?: string | null;
    uso_cfdi_default?: string | null;
    metodo_pago_default?: string | null;
    forma_pago_default?: string | null;
  };
  datos_fiscales: {
    rfc?: string | null;
    razon_social?: string | null;
    regimen_fiscal?: string | null;
    regimenes_fiscales_detectados?: FiscalRegimeOption[] | null;
    regimen_fiscal_pendiente_seleccion?: boolean | null;
    codigo_postal?: string | null;
    correo?: string | null;
    archivo_csf_url?: string | null;
  };
  portal_auth?: PortalAuthState;
}

type PortalModule =
  | "resumen"
  | "pago"
  | "facturas";

type InvoiceDialog = {
  title: string;
  message: string;
  actionLabel?: string;
  actionModule?: PortalModule;
  variant?: "info" | "warning" | "error";
};

const PAGE_SIZE = 10;
const MAX_UPLOAD_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const ALLOWED_UPLOAD_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];

interface FieldInfo {
  title: string;
  body: string;
  details?: string[];
}

interface UploadFormErrors {
  cuenta?: string;
  monto?: string;
  referencia?: string;
  fecha_pago?: string;
  archivo?: string;
  notas?: string;
}

interface CsfFormErrors {
  scope?: string;
  archivo?: string;
}

const PORTAL_FIELD_INFO = {
  transferencia_beneficiario: {
    title: "Beneficiario",
    body:
      "Nombre de la cuenta receptora a la que debes transferir. Debe coincidir con los datos que aparecen en tu banca.",
    details: [
      "Usa este dato solo como referencia de pago.",
      "Si no coincide con tu banco, contacta a administracion antes de transferir.",
    ],
  },
  transferencia_banco: {
    title: "Banco",
    body:
      "Institucion bancaria donde se recibira el pago. Ayuda a confirmar que estas usando la cuenta correcta.",
  },
  transferencia_clabe: {
    title: "CLABE",
    body:
      "Cuenta CLABE para transferencias SPEI. Copiala completa y verifica los 18 digitos antes de confirmar el pago.",
    details: [
      "No agregues espacios ni guiones en tu banca si el campo no los acepta.",
      "BetterP no mueve dinero; solo registra el comprobante para revision.",
    ],
  },
  transferencia_referencia: {
    title: "Referencia bancaria",
    body:
      "Referencia sugerida para que administracion identifique tu pago y lo relacione con tu cuenta abierta.",
    details: [
      "Copiala tal como aparece.",
      "Si tu banco no permite referencia, explica el caso en comentarios al subir el comprobante.",
    ],
  },
  cuenta: {
    title: "Cuenta a pagar",
    body:
      "Concepto abierto al que quieres aplicar el comprobante. Selecciona la cuenta correcta para evitar revisiones manuales innecesarias.",
    details: [
      "Obligatorio.",
      "Solo aparecen cuentas abiertas o con saldo pendiente.",
      "Si pagaste varias cuentas juntas, elige la principal y explicalo en comentarios.",
    ],
  },
  monto: {
    title: "Monto pagado",
    body:
      "Cantidad transferida segun tu comprobante. Debe ser mayor a cero y no puede exceder el saldo pendiente de la cuenta seleccionada.",
    details: [
      "Obligatorio.",
      "Solo acepta numeros y hasta 2 decimales.",
      "No uses simbolos de moneda, comas ni texto. Ejemplo: 10290.00.",
    ],
  },
  referencia: {
    title: "Referencia reportada",
    body:
      "Folio, referencia bancaria o texto que usaste en la transferencia. Sirve para localizar el movimiento cuando administracion revise el pago.",
    details: [
      "Opcional, pero recomendado.",
      "Maximo 80 caracteres.",
      "Acepta letras, numeros, espacios, guion, diagonal, punto y #.",
    ],
  },
  fecha_pago: {
    title: "Fecha de pago",
    body:
      "Dia en que realizaste la transferencia. Ayuda a ubicar el movimiento en banco y acelerar la aplicacion del pago.",
    details: [
      "Opcional.",
      "Si se captura, no puede ser una fecha futura.",
      "Usa la fecha real que aparece en el comprobante.",
    ],
  },
  archivo: {
    title: "Archivo comprobante",
    body:
      "Archivo que demuestra la transferencia o deposito. Administracion lo revisara antes de aplicar el pago.",
    details: [
      "Obligatorio.",
      "Formatos permitidos: PDF, PNG, JPG, JPEG o WEBP.",
      "Tamano maximo: 10 MB.",
    ],
  },
  notas: {
    title: "Comentarios para revision",
    body:
      "Aclaracion opcional para que administracion entienda pagos parciales, pagos agrupados o referencias distintas.",
    details: [
      "Opcional.",
      "Maximo 300 caracteres.",
      "No incluyas datos sensibles de tarjeta o claves bancarias.",
    ],
  },
  csf_scope: {
    title: "Quien recibira la factura",
    body:
      "Indica si la CSF pertenece al ocupante registrado o a otra persona/empresa que recibira el CFDI.",
    details: [
      "Obligatorio antes de cargar la CSF.",
      "Esto no cambia el nombre operativo del cliente ni la ocupacion.",
      "Ejemplo: una persona renta, pero la factura sale a una empresa o familiar.",
    ],
  },
  csf_file: {
    title: "Constancia de Situacion Fiscal",
    body:
      "Documento PDF de la CSF. BetterP extrae RFC, nombre / razon social, regimen y codigo postal fiscal.",
    details: [
      "Obligatorio si necesitas facturar y aun no hay CSF cargada.",
      "Solo se acepta PDF.",
      "Tamano maximo: 10 MB.",
    ],
  },
  fiscal_razon_social: {
    title: "Nombre / razon social fiscal",
    body:
      "Nombre fiscal del receptor que se usara para emitir CFDI. Puede ser distinto al nombre del ocupante.",
  },
  fiscal_rfc: {
    title: "RFC fiscal",
    body:
      "RFC del receptor de la factura. Debe coincidir con la CSF cargada para evitar rechazos al timbrar.",
  },
  fiscal_codigo_postal: {
    title: "Codigo postal fiscal",
    body:
      "Codigo postal fiscal del receptor. Es requerido por CFDI y debe coincidir con la CSF.",
  },
  fiscal_regimen: {
    title: "Regimen fiscal",
    body:
      "Regimen fiscal del receptor. Debe ser el regimen vigente que aparece en la CSF.",
  },
} satisfies Record<string, FieldInfo>;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Sin fecha";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function formatPercent(value?: number | null) {
  return `${new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value || 0)}%`;
}

function categoryLabel(value: string) {
  switch (value) {
    case "POR_VENCER":
      return "Por vencer";
    case "EN_GRACIA":
      return "En gracia";
    case "VENCIDA_CON_RECARGO":
      return "Vencida con recargo";
    case "PAGADA":
      return "Pagada";
    default:
      return value;
  }
}

function categoryPriority(value: string) {
  switch (value) {
    case "VENCIDA_CON_RECARGO":
      return 1;
    case "EN_GRACIA":
      return 2;
    case "POR_VENCER":
      return 3;
    case "PAGADA":
      return 4;
    default:
      return 5;
  }
}

function categoryBadgeClass(value: string) {
  switch (value) {
    case "VENCIDA_CON_RECARGO":
      return "border-rose-400/30 bg-rose-500/10 text-rose-100";
    case "EN_GRACIA":
      return "border-amber-400/30 bg-amber-500/10 text-amber-100";
    case "POR_VENCER":
      return "border-cyan-400/30 bg-cyan-500/10 text-cyan-100";
    case "PAGADA":
      return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
    default:
      return "border-zinc-700 bg-zinc-900 text-zinc-200";
  }
}

function evidenceStatusLabel(value: string) {
  switch (value) {
    case "APLICADA":
      return "Aplicado";
    case "VALIDADA":
      return "Validado";
    case "DESCARTADA":
      return "Descartado";
    case "NUEVA":
      return "En revision";
    default:
      return value;
  }
}

function invoiceFolio(invoice: PortalFactura) {
  return `${invoice.serie || ""}${invoice.folio || ""}`.trim() || `Factura ${invoice.id}`;
}

function invoiceCanDownload(invoice?: PortalFactura | null) {
  return Boolean(invoice?.estatus === "TIMBRADA" && invoice.proveedor_factura_id);
}

function invoiceDownloadUnavailableMessage(invoice: PortalFactura) {
  if (invoice.estatus === "ERROR") {
    return (
      invoice.error_proveedor ||
      "La factura tuvo un error de timbrado. Reintenta generarla o contacta a administracion."
    );
  }
  if (invoice.estatus === "TIMBRADA" && !invoice.proveedor_factura_id) {
    return "La factura esta timbrada, pero aun no tiene archivos PDF/XML disponibles para descarga.";
  }
  return "La factura aun no esta timbrada o no tiene archivos PDF/XML disponibles.";
}

function fiscalRegimeOptionLabel(option: FiscalRegimeOption) {
  return (
    option.label ||
    [option.codigo, option.descripcion].filter(Boolean).join(" - ") ||
    "Regimen fiscal"
  );
}

function fiscalRegimeOptionValue(option: FiscalRegimeOption) {
  return option.codigo || option.label || option.descripcion || "";
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        d="M12 15V4m0 0 4 4m-4-4-4 4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M5 15v3.5A1.5 1.5 0 0 0 6.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <path
        d="M4 7h16m-2 0-.7 12.2A2 2 0 0 1 15.3 21H8.7a2 2 0 0 1-2-1.8L6 7m3 0V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7m-5 4v5m4-5v5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function daysFromToday(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);
  return Math.round((parsed.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function dueDistanceLabel(value?: string | null) {
  const days = daysFromToday(value);
  if (days === null) return "";
  if (days === 0) return "Vence hoy";
  if (days > 0) return `Vence en ${days} dia${days === 1 ? "" : "s"}`;
  const overdueDays = Math.abs(days);
  return `${overdueDays} dia${overdueDays === 1 ? "" : "s"} de atraso`;
}

function formatOtpCountdown(seconds: number) {
  const safeSeconds = Math.max(Math.ceil(seconds), 0);
  if (safeSeconds < 60) {
    return `${safeSeconds}s`;
  }
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function extractOtpWaitSeconds(detail?: string) {
  if (!detail) return 0;
  const match = detail.match(/(\d+)\s*segundo/i);
  const seconds = match ? Number(match[1]) : 0;
  return Number.isFinite(seconds) ? Math.max(seconds, 0) : 0;
}

function portalStatusSummary(data: PortalPayload) {
  if (data.resumen.saldo_vivo <= 0) {
    return {
      label: "Cuenta al corriente",
      description: "No tienes saldo pendiente registrado en este portal.",
      className: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
    };
  }
  if (data.resumen.cuentas_vencidas_abiertas > 0) {
    return {
      label: "Pago vencido",
      description: "Hay una cuenta vencida. Comparte tu comprobante o contacta a administracion.",
      className: "border-rose-400/30 bg-rose-500/10 text-rose-100",
    };
  }
  if (data.resumen.cuentas_en_gracia > 0) {
    return {
      label: "En periodo de gracia",
      description: "Aun puedes regularizar el pago antes de que se aplique como vencido.",
      className: "border-amber-400/30 bg-amber-500/10 text-amber-100",
    };
  }
  return {
    label: "Pago pendiente",
    description: "Revisa el total a pagar y envia tu comprobante cuando realices la transferencia.",
    className: "border-cyan-400/30 bg-cyan-500/10 text-cyan-100",
  };
}

function sanitizePortalNotes(value: string) {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[^\p{L}\p{N}\s.,;:()/#%$+_-]/gu, "")
    .replace(/\s{2,}/g, " ")
    .slice(0, 300);
}

function hasAllowedFileExtension(fileName: string, allowedExtensions: string[]) {
  const lowerName = fileName.toLowerCase();
  return allowedExtensions.some((extension) => lowerName.endsWith(extension));
}

function getFileValidationError(
  file: File | null,
  allowedMimeTypes: Set<string>,
  allowedExtensions: string[],
  requiredMessage: string
) {
  if (!file) {
    return requiredMessage;
  }
  if (file.size > MAX_UPLOAD_FILE_SIZE) {
    return "El archivo no puede exceder 10 MB.";
  }
  const hasAllowedType = file.type ? allowedMimeTypes.has(file.type) : false;
  const hasAllowedExtension = hasAllowedFileExtension(file.name, allowedExtensions);
  if (!hasAllowedType && !hasAllowedExtension) {
    return `Formato no permitido. Usa ${allowedExtensions.join(", ").toUpperCase()}.`;
  }
  return "";
}

function validateUploadForm({
  notas,
  file,
}: {
  notas: string;
  file: File | null;
}) {
  const errors: UploadFormErrors = {};
  const cleanNotas = notas.trim();

  const fileError = getFileValidationError(
    file,
    ALLOWED_UPLOAD_MIME_TYPES,
    ALLOWED_UPLOAD_EXTENSIONS,
    "Selecciona el comprobante de pago."
  );
  if (fileError) {
    errors.archivo = fileError;
  }

  if (cleanNotas.length > 300) {
    errors.notas = "Comentarios no debe superar 300 caracteres.";
  }

  return errors;
}

function validateCsfUpload(
  file: File | null | undefined,
  scope: "same" | "different" | ""
) {
  const errors: CsfFormErrors = {};
  if (!scope) {
    errors.scope =
      "Indica si los datos fiscales pertenecen al ocupante o a otra persona/empresa.";
  }
  const fileError = getFileValidationError(
    file || null,
    new Set(["application/pdf"]),
    [".pdf"],
    "Selecciona la CSF en PDF."
  );
  if (fileError) {
    errors.archivo = fileError;
  }
  return errors;
}

function hasFormErrors(errors: UploadFormErrors | CsfFormErrors) {
  return Object.values(errors).some(Boolean);
}

function firstFormError(errors: UploadFormErrors | CsfFormErrors) {
  return Object.values(errors).find(Boolean) || "Revisa los campos marcados.";
}

function fieldClass(error?: string) {
  return `w-full rounded-2xl border bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:ring-1 ${
    error
      ? "border-rose-400/60 focus:border-rose-400 focus:ring-rose-400"
      : "border-zinc-800 focus:border-cyan-400 focus:ring-cyan-400"
  }`;
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
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="portal-field-info-title"
        className="w-full max-w-lg rounded-3xl border border-cyan-400/20 bg-zinc-950 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">
              Detalle del campo
            </p>
            <h2
              id="portal-field-info-title"
              className="mt-2 text-xl font-semibold text-white"
            >
              {info.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/10"
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
                className="rounded-2xl border border-white/10 bg-zinc-900/70 px-4 py-3"
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
    <label className="flex min-h-7 flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
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
    <p className={`text-xs leading-5 ${error ? "text-rose-200" : "text-zinc-500"}`}>
      {error || helper}
    </p>
  );
}

function PortalBlockingOverlay({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div
      role="status"
      aria-live="assertive"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-3xl border border-cyan-400/25 bg-zinc-950 p-6 text-center shadow-2xl shadow-cyan-950/30">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-cyan-300/25 border-t-cyan-200" />
        <p className="mt-4 text-sm font-semibold text-white">{title}</p>
        <p className="mt-2 text-sm leading-6 text-zinc-400">{message}</p>
      </div>
    </div>
  );
}

export default function PortalClienteClient({ token }: { token: string }) {
  const csfInputRef = useRef<HTMLInputElement | null>(null);
  const portalSessionStorageKey = `betterp.portal.session.${token}`;
  const [portalSessionToken, setPortalSessionToken] = useState(() =>
    typeof window === "undefined"
      ? ""
      : window.sessionStorage.getItem(portalSessionStorageKey) || ""
  );
  const [activeModule, setActiveModule] = useState<PortalModule>("resumen");
  const [data, setData] = useState<PortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadNotas, setUploadNotas] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFileKey, setUploadFileKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadFormErrors, setUploadFormErrors] = useState<UploadFormErrors>({});
  const [copiedKey, setCopiedKey] = useState("");
  const [invoiceIssuingId, setInvoiceIssuingId] = useState<number | null>(null);
  const [invoiceMessage, setInvoiceMessage] = useState("");
  const [invoiceError, setInvoiceError] = useState("");
  const [invoiceDialog, setInvoiceDialog] = useState<InvoiceDialog | null>(null);
  const [csfUploading, setCsfUploading] = useState(false);
  const [csfDeleting, setCsfDeleting] = useState(false);
  const [csfMessage, setCsfMessage] = useState("");
  const [csfError, setCsfError] = useState("");
  const [csfFormErrors, setCsfFormErrors] = useState<CsfFormErrors>({});
  const [csfRecipientScope, setCsfRecipientScope] = useState<"same" | "different" | "">("");
  const [selectedFiscalRegime, setSelectedFiscalRegime] = useState("");
  const [savingFiscalRegime, setSavingFiscalRegime] = useState(false);
  const [fieldInfo, setFieldInfo] = useState<FieldInfo | null>(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [accountStatusFilter, setAccountStatusFilter] = useState("TODOS");
  const [accountPage, setAccountPage] = useState(1);
  const [evidenceSearch, setEvidenceSearch] = useState("");
  const [evidenceStatusFilter, setEvidenceStatusFilter] = useState("TODOS");
  const [evidencePage, setEvidencePage] = useState(1);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState("TODOS");
  const [invoicePage, setInvoicePage] = useState(1);
  const [consentCommunicationAccepted, setConsentCommunicationAccepted] = useState(false);
  const [consentContactAccepted, setConsentContactAccepted] = useState(false);
  const [consentSubmitting, setConsentSubmitting] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [consentMessage, setConsentMessage] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpMessage, setOtpMessage] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpResendRemaining, setOtpResendRemaining] = useState(0);
  const [otpResendInitial, setOtpResendInitial] = useState(0);

  const portalSessionHeaders = useCallback(
    (base: Record<string, string> = {}) =>
      portalSessionToken
        ? { ...base, "X-Portal-Session": portalSessionToken }
        : base,
    [portalSessionToken]
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(buildApiUrl(`/comunicaciones/portal/${token}/`), {
          cache: "no-store",
          headers: portalSessionHeaders(),
        });
        const body = (await response.json().catch(() => ({}))) as PortalPayload & {
          detail?: string;
        };
        if (!response.ok) {
          throw new Error(body.detail || "No pudimos abrir tu portal.");
        }
        if (!cancelled) {
          setData(body);
          if (
            portalSessionToken &&
            body.portal_auth?.required &&
            !body.portal_auth.verified
          ) {
            window.sessionStorage.removeItem(portalSessionStorageKey);
            setPortalSessionToken("");
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "No pudimos cargar el estado de cuenta."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [token, portalSessionToken, portalSessionHeaders, portalSessionStorageKey]);

  useEffect(() => {
    if (!data?.datos_fiscales.regimen_fiscal_pendiente_seleccion) {
      setSelectedFiscalRegime("");
    }
  }, [data?.datos_fiscales.regimen_fiscal_pendiente_seleccion]);

  useEffect(() => {
    if (otpResendRemaining <= 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOtpResendRemaining((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [otpResendRemaining]);

  useEffect(() => {
    setAccountPage(1);
  }, [accountSearch, accountStatusFilter]);

  useEffect(() => {
    setEvidencePage(1);
  }, [evidenceSearch, evidenceStatusFilter]);

  useEffect(() => {
    setInvoicePage(1);
  }, [invoiceSearch, invoiceStatusFilter]);

  const detectedFiscalRegimes = data?.datos_fiscales.regimenes_fiscales_detectados || [];
  const fiscalRegimePendingSelection = Boolean(
    data?.datos_fiscales.regimen_fiscal_pendiente_seleccion &&
      detectedFiscalRegimes.length > 1
  );
  const portalAuth = data?.portal_auth;
  const otpCooldownActive = otpResendRemaining > 0;
  const otpCooldownProgress =
    otpCooldownActive && otpResendInitial > 0
      ? Math.max(0, Math.min(100, (otpResendRemaining / otpResendInitial) * 100))
      : 0;
  const portalAuthLocked = Boolean(portalAuth?.required && !portalAuth.verified);
  const showAuthGate = Boolean(data && portalAuthLocked);
  const collectionConsent = data?.consentimiento_cobranza;
  const requiresCollectionConsent = Boolean(
    collectionConsent?.requerido && !collectionConsent.aceptado
  );
  const showCollectionConsentGate = Boolean(
    data && !portalAuthLocked && requiresCollectionConsent && collectionConsent
  );
  const openAccounts = (data?.cuentas || [])
    .filter((cuenta) => cuenta.categoria_tablero !== "PAGADA" && cuenta.total_a_pagar > 0)
    .sort((first, second) => {
      const categoryDiff =
        categoryPriority(first.categoria_tablero) - categoryPriority(second.categoria_tablero);
      if (categoryDiff !== 0) {
        return categoryDiff;
      }
      return (
        new Date(first.fecha_vencimiento).getTime() -
        new Date(second.fecha_vencimiento).getTime()
      );
    });
  const priorityAccount = openAccounts[0];
  const accountStatus = data ? portalStatusSummary(data) : null;
  const accountQuery = accountSearch.trim().toLowerCase();
  const filteredAccounts = (data?.cuentas || []).filter((cuenta) => {
    const matchesStatus =
      accountStatusFilter === "TODOS" || cuenta.categoria_tablero === accountStatusFilter;
    const matchesSearch =
      !accountQuery ||
      cuenta.concepto.toLowerCase().includes(accountQuery) ||
      (cuenta.espacio_codigo || "").toLowerCase().includes(accountQuery);
    return matchesStatus && matchesSearch;
  });
  const accountTotalPages = Math.max(1, Math.ceil(filteredAccounts.length / PAGE_SIZE));
  const pagedAccounts = filteredAccounts.slice(
    (accountPage - 1) * PAGE_SIZE,
    accountPage * PAGE_SIZE
  );
  const evidenceQuery = evidenceSearch.trim().toLowerCase();
  const filteredEvidence = (data?.comprobantes_recientes || []).filter((item) => {
    const matchesStatus =
      evidenceStatusFilter === "TODOS" || item.estatus === evidenceStatusFilter;
    const matchesSearch =
      !evidenceQuery ||
      (item.archivo_nombre || "").toLowerCase().includes(evidenceQuery) ||
      (item.referencia_reportada || "").toLowerCase().includes(evidenceQuery);
    return matchesStatus && matchesSearch;
  });
  const evidenceTotalPages = Math.max(1, Math.ceil(filteredEvidence.length / PAGE_SIZE));
  const pagedEvidence = filteredEvidence.slice(
    (evidencePage - 1) * PAGE_SIZE,
    evidencePage * PAGE_SIZE
  );
  const invoiceQuery = invoiceSearch.trim().toLowerCase();
  const filteredInvoices = (data?.facturas_recientes || []).filter((invoice) => {
    const folio = invoiceFolio(invoice).toLowerCase();
    const matchesStatus =
      invoiceStatusFilter === "TODOS" || invoice.estatus === invoiceStatusFilter;
    const matchesSearch =
      !invoiceQuery ||
      folio.includes(invoiceQuery) ||
      (invoice.uuid || "").toLowerCase().includes(invoiceQuery);
    return matchesStatus && matchesSearch;
  });
  const invoiceTotalPages = Math.max(1, Math.ceil(filteredInvoices.length / PAGE_SIZE));
  const pagedInvoices = filteredInvoices.slice(
    (invoicePage - 1) * PAGE_SIZE,
    invoicePage * PAGE_SIZE
  );
  const actionButtonBase =
    "inline-flex items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
  const primaryActionButton =
    `${actionButtonBase} border-cyan-400/25 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20`;
  const secondaryActionButton =
    `${actionButtonBase} border-zinc-700 bg-zinc-900/60 text-zinc-100 hover:bg-zinc-800`;
  const iconActionButton =
    "group relative inline-flex h-12 w-12 items-center justify-center rounded-2xl border text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const successIconButton =
    `${iconActionButton} border-emerald-400/25 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20`;
  const primaryIconButton =
    `${iconActionButton} border-cyan-400/25 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20`;
  const dangerIconButton =
    `${iconActionButton} border-rose-400/25 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20`;
  const transferFieldInfoByKey: Record<string, FieldInfo> = {
    beneficiario: PORTAL_FIELD_INFO.transferencia_beneficiario,
    banco: PORTAL_FIELD_INFO.transferencia_banco,
    clabe: PORTAL_FIELD_INFO.transferencia_clabe,
    referencia: PORTAL_FIELD_INFO.transferencia_referencia,
  };
  const moduleTabs: Array<{
    id: PortalModule;
    label: string;
    badge?: string | number;
  }> = [
    { id: "resumen", label: "Resumen" },
    { id: "pago", label: "Pagos cliente", badge: openAccounts.length },
    { id: "facturas", label: "Facturas", badge: data?.facturas_recientes.length || 0 },
  ];

  const copyToClipboard = async (value: string | null | undefined, key: string) => {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? "" : current));
      }, 1800);
    } catch {
      setUploadError("No pudimos copiar el dato. Intenta seleccionarlo manualmente.");
    }
  };

  const renderPagination = (
    page: number,
    totalPages: number,
    onPageChange: (page: number) => void
  ) => (
    <div className="mt-4 flex flex-col gap-3 border-t border-zinc-900 pt-4 text-sm text-zinc-400 sm:flex-row sm:items-center sm:justify-between">
      <span>
        Pagina {page} de {totalPages}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className={secondaryActionButton}
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className={secondaryActionButton}
        >
          Siguiente
        </button>
      </div>
    </div>
  );

  const renderListFilters = (
    search: string,
    onSearchChange: (value: string) => void,
    status: string | null,
    onStatusChange: ((value: string) => void) | null,
    options: Array<{ value: string; label: string }>,
    placeholder: string
  ) => (
    <div className="mt-4 grid gap-3 border-t border-zinc-900 pt-4 sm:grid-cols-[1fr_220px]">
      <input
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400"
      />
      {onStatusChange ? (
        <select
          value={status || "TODOS"}
          onChange={(event) => onStatusChange(event.target.value)}
          className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );

  const renderTooltip = (label: string) => (
    <span className="pointer-events-none absolute -top-11 left-1/2 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-100 shadow-xl group-hover:block group-focus-visible:block">
      {label}
    </span>
  );

  const clearUploadFieldError = (field: keyof UploadFormErrors) => {
    setUploadError("");
    setUploadFormErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const clearCsfFieldError = (field: keyof CsfFormErrors) => {
    setCsfError("");
    setCsfFormErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const renderTransferValue = (
    label: string,
    value: string | null | undefined,
    key: string
  ) => (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-2">
        <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-100/70">
          {label}
        </p>
        <InfoButton info={transferFieldInfoByKey[key]} onInfo={setFieldInfo} />
      </div>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="break-all text-sm font-medium text-white">
          {value || "Pendiente"}
        </p>
        {value ? (
          <button
            type="button"
            onClick={() => void copyToClipboard(value, key)}
            className="shrink-0 rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/20"
          >
            {copiedKey === key ? "Copiado" : "Copiar"}
          </button>
        ) : null}
      </div>
    </div>
  );

  const requestPortalOtp = async () => {
    setOtpError("");
    setOtpMessage("");
    setOtpSending(true);
    try {
      const response = await fetch(
        buildApiUrl(`/comunicaciones/portal/${token}/otp/request/`),
        { method: "POST" }
      );
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
        masked_phone?: string | null;
        portal?: PortalPayload;
        resend_seconds?: number;
      };
      if (!response.ok) {
        const waitSeconds = extractOtpWaitSeconds(body.detail);
        if (waitSeconds > 0) {
          setOtpResendInitial(waitSeconds);
          setOtpResendRemaining(waitSeconds);
        }
        throw new Error(body.detail || "No pudimos enviar el codigo.");
      }
      if (body.portal) {
        setData(body.portal);
      }
      const cooldownSeconds = Math.max(
        Number(body.resend_seconds ?? portalAuth?.resend_seconds ?? 0),
        0
      );
      if (cooldownSeconds > 0) {
        setOtpResendInitial(cooldownSeconds);
        setOtpResendRemaining(cooldownSeconds);
      }
      setOtpMessage(
        body.mensaje ||
          `Codigo enviado por WhatsApp${
            body.masked_phone ? ` a ${body.masked_phone}` : ""
          }.`
      );
    } catch (otpFailure) {
      setOtpError(
        otpFailure instanceof Error
          ? otpFailure.message
          : "No pudimos enviar el codigo."
      );
    } finally {
      setOtpSending(false);
    }
  };

  const verifyPortalOtp = async () => {
    setOtpError("");
    setOtpMessage("");
    const cleanCode = otpCode.replace(/\D/g, "");
    setOtpCode(cleanCode);
    if (cleanCode.length !== 6) {
      setOtpError("Ingresa el codigo de 6 digitos.");
      return;
    }
    setOtpVerifying(true);
    try {
      const response = await fetch(
        buildApiUrl(`/comunicaciones/portal/${token}/otp/verify/`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codigo: cleanCode }),
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
        portal_session_token?: string;
        portal?: PortalPayload;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No pudimos validar el codigo.");
      }
      if (body.portal_session_token) {
        window.sessionStorage.setItem(portalSessionStorageKey, body.portal_session_token);
        setPortalSessionToken(body.portal_session_token);
      }
      if (body.portal) {
        setData(body.portal);
      }
      setOtpCode("");
      setOtpResendInitial(0);
      setOtpResendRemaining(0);
      setOtpMessage(body.mensaje || "Acceso validado correctamente.");
    } catch (otpFailure) {
      setOtpError(
        otpFailure instanceof Error
          ? otpFailure.message
          : "No pudimos validar el codigo."
      );
    } finally {
      setOtpVerifying(false);
    }
  };

  const acceptCollectionConsent = async () => {
    setConsentError("");
    setConsentMessage("");
    if (!consentCommunicationAccepted || !consentContactAccepted) {
      setConsentError("Marca ambas confirmaciones para continuar.");
      return;
    }

    setConsentSubmitting(true);
    try {
      const response = await fetch(
        buildApiUrl(`/comunicaciones/portal/${token}/consentimiento-cobranza/`),
        {
          method: "POST",
          headers: portalSessionHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            acepta_comunicaciones_cobranza: consentCommunicationAccepted,
            acepta_actualizacion_contacto: consentContactAccepted,
          }),
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
        portal?: PortalPayload;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No pudimos registrar el consentimiento.");
      }
      if (body.portal) {
        setData(body.portal);
      }
      setConsentMessage(body.mensaje || "Consentimiento registrado correctamente.");
    } catch (consentFailure) {
      setConsentError(
        consentFailure instanceof Error
          ? consentFailure.message
          : "No pudimos registrar el consentimiento."
      );
    } finally {
      setConsentSubmitting(false);
    }
  };

  const downloadInvoice = async (invoice: PortalFactura, format: "pdf" | "xml") => {
    setInvoiceError("");
    setInvoiceMessage("");
    setInvoiceDialog(null);
    if (requiresCollectionConsent) {
      const message = "Acepta el consentimiento de comunicaciones antes de descargar facturas.";
      setInvoiceError(message);
      setInvoiceDialog({
        title: "Consentimiento requerido",
        message,
        variant: "warning",
      });
      return;
    }
    if (!invoiceCanDownload(invoice)) {
      const message = invoiceDownloadUnavailableMessage(invoice);
      setInvoiceError(message);
      setInvoiceDialog({
        title: "Factura no descargable todavia",
        message,
        actionLabel: "Revisar Facturacion",
        actionModule: "facturas",
        variant: invoice.estatus === "ERROR" ? "error" : "warning",
      });
      return;
    }
    try {
      const response = await fetch(
        buildApiUrl(`/comunicaciones/portal/${token}/facturas/${invoice.id}/${format}/`),
        {
          cache: "no-store",
          headers: portalSessionHeaders(),
        }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail || `No pudimos descargar el archivo ${format.toUpperCase()}.`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${invoiceFolio(invoice)}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (downloadError) {
      const message =
        downloadError instanceof Error
          ? downloadError.message
          : "No pudimos descargar la factura.";
      setInvoiceError(message);
      setInvoiceDialog({
        title: "No se pudo descargar la factura",
        message,
        actionLabel: "Revisar Facturacion",
        actionModule: "facturas",
        variant: "error",
      });
    }
  };

  const requestInvoice = async (cuenta: PortalCuenta) => {
    setInvoiceError("");
    setInvoiceMessage("");
    setInvoiceDialog(null);
    if (requiresCollectionConsent) {
      setInvoiceError("Acepta el consentimiento de comunicaciones antes de solicitar factura.");
      return;
    }
    if (cuenta.factura && invoiceCanDownload(cuenta.factura)) {
      setInvoiceMessage("Esta cuenta ya tiene factura disponible.");
      return;
    }
    if (cuenta.total_a_pagar > 0 || cuenta.categoria_tablero !== "PAGADA") {
      setInvoiceDialog({
        title: "Factura pendiente de pago",
        message:
          "La factura se podra generar y descargar una vez que recibamos y apliquemos tu pago.",
        variant: "info",
      });
      return;
    }
    if (!data?.facturacion.activa) {
      setInvoiceError("La facturacion aun no esta activa para este negocio.");
      setInvoiceDialog({
        title: "Facturacion no disponible",
        message: "La facturacion aun no esta activa para este negocio.",
        variant: "warning",
      });
      return;
    }
    if (data.datos_fiscales.regimen_fiscal_pendiente_seleccion) {
      const pendingRegimeMessage =
        "Tu CSF tiene mas de un regimen fiscal. Para poder generar la factura, selecciona en la pestana Facturacion el regimen con el que quieres timbrar.";
      setInvoiceError(pendingRegimeMessage);
      setInvoiceDialog({
        title: "Confirma tu regimen fiscal",
        message: pendingRegimeMessage,
        actionLabel: "Ir a Facturacion",
        actionModule: "facturas",
        variant: "warning",
      });
      return;
    }
    if (
      !data.datos_fiscales.razon_social ||
      !data.datos_fiscales.rfc ||
      !data.datos_fiscales.regimen_fiscal ||
      !data.datos_fiscales.codigo_postal
    ) {
      const missingFiscalMessage =
        "Para poder generar la factura hay que llenar los datos de facturacion en la pestana Facturacion.";
      setInvoiceError(missingFiscalMessage);
      setInvoiceDialog({
        title: "Datos fiscales requeridos",
        message: `${missingFiscalMessage} Carga tu constancia de situacion fiscal para completar razon social, RFC, regimen fiscal y codigo postal.`,
        actionLabel: "Ir a Facturacion",
        actionModule: "facturas",
        variant: "warning",
      });
      return;
    }

    setInvoiceIssuingId(cuenta.id);
    try {
      const response = await fetch(
        buildApiUrl(`/comunicaciones/portal/${token}/cuentas/${cuenta.id}/factura/`),
        {
          method: "POST",
          headers: portalSessionHeaders(),
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
        factura?: PortalFactura | null;
        portal?: PortalPayload;
      };
      if (body.portal) {
        setData(body.portal);
      }
      if (!response.ok) {
        const fallbackMessage =
          response.status >= 500
            ? "El proveedor de facturacion no pudo timbrar la factura en este momento. Revisa los datos fiscales o intenta de nuevo mas tarde."
            : "No pudimos generar la factura.";
        throw new Error(body.detail || fallbackMessage);
      }
      setInvoiceMessage(body.mensaje || "Factura emitida correctamente.");
    } catch (invoiceFailure) {
      const message =
        invoiceFailure instanceof Error
          ? invoiceFailure.message
          : "No pudimos generar la factura.";
      setInvoiceError(message);
      setInvoiceDialog({
        title: "No se pudo generar la factura",
        message,
        actionLabel: "Revisar Facturacion",
        actionModule: "facturas",
        variant: "error",
      });
    } finally {
      setInvoiceIssuingId(null);
    }
  };

  const renderInvoiceDownloadActions = (
    invoice: PortalFactura,
    options: { cuenta?: PortalCuenta; compact?: boolean; alignEnd?: boolean } = {}
  ) => {
    const buttonClass = options.compact
      ? `${secondaryActionButton} px-2.5 py-1`
      : secondaryActionButton;
    if (invoiceCanDownload(invoice)) {
      return (
        <div
          className={`flex flex-wrap gap-2 ${options.alignEnd ? "sm:justify-end" : ""}`}
        >
          <button
            type="button"
            onClick={() => void downloadInvoice(invoice, "pdf")}
            className={buttonClass}
          >
            PDF
          </button>
          <button
            type="button"
            onClick={() => void downloadInvoice(invoice, "xml")}
            className={buttonClass}
          >
            XML
          </button>
        </div>
      );
    }

    const canRetry = options.cuenta && invoice.estatus !== "TIMBRADA";
    return (
      <div className={`flex flex-wrap items-center gap-2 ${options.alignEnd ? "sm:justify-end" : ""}`}>
        <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100">
          {invoice.estatus === "ERROR" ? "Error de timbrado" : "En proceso"}
        </span>
        {canRetry ? (
          <button
            type="button"
            onClick={() => void requestInvoice(options.cuenta!)}
            disabled={invoiceIssuingId === options.cuenta!.id}
            className={options.compact ? `${primaryActionButton} px-2.5 py-1` : primaryActionButton}
          >
            {invoiceIssuingId === options.cuenta!.id ? "Generando..." : "Reintentar factura"}
          </button>
        ) : null}
      </div>
    );
  };

  const submitComprobante = async () => {
    setUploadError("");
    setUploadMessage("");
    if (requiresCollectionConsent) {
      setUploadError("Acepta el consentimiento de comunicaciones antes de cargar comprobantes.");
      return;
    }
    const cleanNotas = sanitizePortalNotes(uploadNotas).trim();
    const validationErrors = validateUploadForm({
      notas: cleanNotas,
      file: uploadFile,
    });
    setUploadNotas(cleanNotas);
    setUploadFormErrors(validationErrors);
    if (hasFormErrors(validationErrors)) {
      setUploadError(firstFormError(validationErrors));
      return;
    }
    if (!uploadFile) {
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("notas", cleanNotas);
      formData.append("archivo", uploadFile);
      const response = await fetch(
        buildApiUrl(`/comunicaciones/portal/${token}/comprobantes/`),
        {
          method: "POST",
          headers: portalSessionHeaders(),
          body: formData,
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
        resultado?: string;
        acuse_whatsapp_pago?: {
          enviado?: boolean;
          omitido?: boolean;
          motivo?: string;
          template_name?: string;
          error?: string;
        };
        portal?: PortalPayload;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No pudimos cargar el comprobante.");
      }
      if (body.portal) {
        setData(body.portal);
      }
      setUploadFile(null);
      setUploadFileKey((current) => current + 1);
      setUploadNotas("");
      setUploadFormErrors({});
      const defaultUploadMessage =
        body.mensaje ||
          (body.resultado === "APLICADO"
            ? "Comprobante recibido y pago aplicado al estado de cuenta."
            : "Comprobante recibido para revision.");
      setUploadMessage(
        body.acuse_whatsapp_pago?.enviado
          ? `${defaultUploadMessage} Tambien enviamos la confirmacion por WhatsApp.`
          : defaultUploadMessage
      );
    } catch (uploadFailure) {
      setUploadError(
        uploadFailure instanceof Error
          ? uploadFailure.message
          : "No pudimos cargar el comprobante."
      );
    } finally {
      setUploading(false);
    }
  };

  const submitCsf = async (file: File | null | undefined) => {
    setCsfError("");
    setCsfMessage("");
    if (requiresCollectionConsent) {
      setCsfError("Acepta el consentimiento de comunicaciones antes de actualizar tus datos fiscales.");
      if (csfInputRef.current) {
        csfInputRef.current.value = "";
      }
      return;
    }
    const validationErrors = validateCsfUpload(file, csfRecipientScope);
    setCsfFormErrors(validationErrors);
    if (hasFormErrors(validationErrors)) {
      setCsfError(firstFormError(validationErrors));
      if (csfInputRef.current) {
        csfInputRef.current.value = "";
      }
      return;
    }
    if (!file) {
      return;
    }

    setCsfUploading(true);
    try {
      const formData = new FormData();
      formData.append("archivo", file);
      const response = await fetch(buildApiUrl(`/comunicaciones/portal/${token}/csf/`), {
        method: "POST",
        headers: portalSessionHeaders(),
        body: formData,
      });
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
        portal?: PortalPayload;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No pudimos cargar tu CSF.");
      }
      if (body.portal) {
        setData(body.portal);
      }
      setCsfFormErrors({});
      const pendingRegime = Boolean(
        body.portal?.datos_fiscales.regimen_fiscal_pendiente_seleccion
      );
      setCsfMessage(
        pendingRegime
          ? "CSF cargada. Detectamos mas de un regimen fiscal; selecciona con cual quieres timbrar."
          : body.mensaje || "Datos fiscales actualizados correctamente."
      );
    } catch (csfFailure) {
      setCsfError(
        csfFailure instanceof Error
          ? csfFailure.message
          : "No pudimos cargar tu CSF."
      );
    } finally {
      setCsfUploading(false);
      if (csfInputRef.current) {
        csfInputRef.current.value = "";
      }
    }
  };

  const confirmFiscalRegime = async () => {
    setCsfError("");
    setCsfMessage("");
    if (requiresCollectionConsent) {
      setCsfError("Acepta el consentimiento de comunicaciones antes de confirmar tu regimen fiscal.");
      return;
    }
    if (!selectedFiscalRegime) {
      setCsfError("Selecciona el regimen fiscal con el que quieres timbrar.");
      return;
    }

    setSavingFiscalRegime(true);
    try {
      const formData = new FormData();
      formData.append("regimen_fiscal", selectedFiscalRegime);
      const response = await fetch(buildApiUrl(`/comunicaciones/portal/${token}/csf/regimen/`), {
        method: "POST",
        headers: portalSessionHeaders(),
        body: formData,
      });
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
        portal?: PortalPayload;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No pudimos confirmar el regimen fiscal.");
      }
      if (body.portal) {
        setData(body.portal);
      }
      setSelectedFiscalRegime("");
      setCsfMessage(body.mensaje || "Regimen fiscal confirmado.");
    } catch (regimeFailure) {
      setCsfError(
        regimeFailure instanceof Error
          ? regimeFailure.message
          : "No pudimos confirmar el regimen fiscal."
      );
    } finally {
      setSavingFiscalRegime(false);
    }
  };

  const deleteCsf = async () => {
    if (!data?.datos_fiscales.archivo_csf_url) {
      return;
    }
    if (requiresCollectionConsent) {
      setCsfError("Acepta el consentimiento de comunicaciones antes de retirar tu CSF.");
      return;
    }
    const confirmed = window.confirm(
      "Quieres quitar la CSF cargada? Podras cargar una nueva despues."
    );
    if (!confirmed) {
      return;
    }

    setCsfError("");
    setCsfMessage("");
    setCsfDeleting(true);
    try {
      const response = await fetch(buildApiUrl(`/comunicaciones/portal/${token}/csf/`), {
        method: "DELETE",
        headers: portalSessionHeaders(),
      });
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
        portal?: PortalPayload;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No pudimos quitar tu CSF.");
      }
      if (body.portal) {
        setData(body.portal);
      }
      setCsfMessage(body.mensaje || "CSF retirada correctamente.");
    } catch (csfFailure) {
      setCsfError(
        csfFailure instanceof Error
          ? csfFailure.message
          : "No pudimos quitar tu CSF."
      );
    } finally {
      setCsfDeleting(false);
    }
  };

  const authGate =
    showAuthGate && portalAuth ? (
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl items-center justify-center">
        <div className="w-full rounded-[32px] border border-cyan-400/30 bg-zinc-950 p-6 shadow-2xl shadow-black/40 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <div>
              <span className="inline-flex rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-100">
                Verificacion requerida
              </span>
              <h1 className="mt-5 text-3xl font-semibold text-white">
                Protegemos tu estado de cuenta
              </h1>
              <p className="mt-3 text-sm leading-7 text-zinc-400">
                Para ver saldos, facturas, datos fiscales o cargar comprobantes,
                confirma tu identidad con un codigo enviado por WhatsApp.
              </p>
              <div className="mt-6 rounded-3xl border border-cyan-400/20 bg-cyan-400/10 p-5">
                <p className="text-sm leading-7 text-zinc-200">
                  El codigo se enviara al telefono registrado
                  {portalAuth.masked_phone ? ` con ${portalAuth.masked_phone}` : ""}.
                  Expira en {portalAuth.code_expires_minutes} minuto(s). Si este
                  telefono no es correcto, contacta a administracion para
                  actualizar tus datos antes de continuar.
                </p>
              </div>
              {portalAuth.detail ? (
                <p className="mt-4 text-xs leading-5 text-zinc-500">
                  {portalAuth.detail}
                </p>
              ) : null}
            </div>

            <div className="rounded-3xl border border-white/10 bg-zinc-900/80 p-4">
              <button
                type="button"
                onClick={() => void requestPortalOtp()}
                disabled={otpSending || otpCooldownActive || !portalAuth.can_request_code}
                className={primaryActionButton + " w-full py-3"}
              >
                {otpSending
                  ? "Enviando codigo..."
                  : otpCooldownActive
                    ? `Pedir otro codigo en ${formatOtpCountdown(otpResendRemaining)}`
                    : "Enviar codigo por WhatsApp"}
              </button>
              {!portalAuth.can_request_code ? (
                <div className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-6 text-amber-100">
                  No hay un WhatsApp autorizado para este portal. Contacta a
                  administracion.
                </div>
              ) : null}
              {otpCooldownActive ? (
                <div className="mt-3 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 p-3 text-sm leading-6 text-cyan-100">
                  <div className="flex items-center justify-between gap-3">
                    <span>Puedes pedir otro codigo cuando termine el conteo.</span>
                    <span className="font-mono text-cyan-50">
                      {formatOtpCountdown(otpResendRemaining)}
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cyan-950">
                    <div
                      className="h-full rounded-full bg-cyan-300 transition-all duration-1000"
                      style={{ width: `${otpCooldownProgress}%` }}
                    />
                  </div>
                </div>
              ) : null}

              <div className="mt-4 space-y-2">
                <FieldLabel
                  label="Codigo de acceso"
                  required
                  info={{
                    title: "Codigo de acceso",
                    body:
                      "Es el codigo de 6 digitos enviado al WhatsApp registrado. No compartas este codigo con terceros.",
                  }}
                  onInfo={setFieldInfo}
                />
                <input
                  value={otpCode}
                  onChange={(event) =>
                    setOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-center text-lg font-semibold tracking-[0.32em] text-white outline-none focus:border-cyan-400"
                />
              </div>

              {otpError ? (
                <div className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                  {otpError}
                </div>
              ) : null}
              {otpMessage ? (
                <div className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                  {otpMessage}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void verifyPortalOtp()}
                disabled={otpVerifying || otpCode.length !== 6}
                className="mt-4 w-full rounded-2xl border border-emerald-500/30 bg-emerald-500/15 px-5 py-3 text-sm font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {otpVerifying ? "Validando..." : "Validar y entrar"}
              </button>
              <p className="mt-4 text-center text-xs leading-5 text-zinc-500">
                Hasta validar el codigo, el portal permanece bloqueado y no
                muestra informacion personal ni financiera.
              </p>
            </div>
          </div>
        </div>
      </section>
    ) : null;

  const consentGate =
    showCollectionConsentGate && collectionConsent ? (
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl items-center justify-center">
        <div className="w-full rounded-[32px] border border-amber-400/30 bg-zinc-950 p-6 shadow-2xl shadow-black/40 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <span className="inline-flex rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-amber-100">
                Acceso requerido
              </span>
              <h1 className="mt-5 text-3xl font-semibold text-white">
                {collectionConsent.titulo}
              </h1>
              <p className="mt-3 text-sm leading-7 text-zinc-400">
                Para consultar tu estado de cuenta, comprobantes y facturas,
                primero confirma estas autorizaciones de comunicacion.
              </p>
              <div className="mt-6 rounded-3xl border border-amber-400/20 bg-amber-400/10 p-5">
                <p className="whitespace-pre-line text-sm leading-7 text-zinc-200">
                  {collectionConsent.texto}
                </p>
              </div>
              <p className="mt-4 text-xs text-zinc-500">
                Version {collectionConsent.version}
              </p>
            </div>

            <div className="w-full rounded-3xl border border-white/10 bg-zinc-900/80 p-4 lg:max-w-sm">
              <label className="flex gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm leading-6 text-zinc-200">
                <input
                  type="checkbox"
                  checked={consentCommunicationAccepted}
                  onChange={(event) =>
                    setConsentCommunicationAccepted(event.target.checked)
                  }
                  className="mt-1 h-4 w-4 accent-cyan-400"
                />
                <span>
                  Acepto recibir comunicaciones transaccionales y de cobranza por
                  los medios registrados.
                </span>
              </label>
              <label className="mt-3 flex gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-sm leading-6 text-zinc-200">
                <input
                  type="checkbox"
                  checked={consentContactAccepted}
                  onChange={(event) => setConsentContactAccepted(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-cyan-400"
                />
                <span>
                  Confirmo que revisare o solicitare actualizar mis datos de contacto
                  si no son correctos.
                </span>
              </label>
              {consentError ? (
                <div className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                  {consentError}
                </div>
              ) : null}
              {consentMessage ? (
                <div className="mt-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                  {consentMessage}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => void acceptCollectionConsent()}
                disabled={consentSubmitting}
                className="mt-4 w-full rounded-2xl border border-cyan-500/30 bg-cyan-500/15 px-5 py-3 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {consentSubmitting ? "Registrando..." : "Aceptar y entrar al portal"}
              </button>
              <p className="mt-4 text-center text-xs leading-5 text-zinc-500">
                Hasta aceptar, el portal permanece bloqueado y no muestra datos de
                cuenta.
              </p>
            </div>
          </div>
        </div>
      </section>
    ) : null;

  return (
    <main
      aria-busy={uploading}
      className="min-h-screen bg-[radial-gradient(circle_at_top,#164e63_0%,#09090b_35%,#020617_100%)] px-4 py-8 text-white sm:px-6 lg:px-8"
    >
      <FieldInfoModal info={fieldInfo} onClose={() => setFieldInfo(null)} />
      {uploading ? (
        <PortalBlockingOverlay
          title="Procesando comprobante"
          message="Estamos subiendo el archivo, leyendo la imagen y actualizando tu estado de cuenta. No cierres esta pantalla."
        />
      ) : null}
      {authGate ? (
        authGate
      ) : consentGate ? (
        consentGate
      ) : (
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-[32px] border border-white/10 bg-zinc-950/85 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
          <span className="inline-flex rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-200">
            Portal cliente
          </span>
          <h1 className="mt-4 text-3xl font-semibold text-white">
            Estado de cuenta y datos de pago
          </h1>
          <p className="mt-3 text-sm leading-7 text-zinc-400">
            Revisa tu saldo, datos para transferencia, comprobantes recibidos y
            facturas disponibles en un solo lugar.
          </p>
        </section>

        {loading ? (
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-10 text-center text-zinc-400">
            Cargando tu portal...
          </section>
        ) : error ? (
          <section className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-6 text-sm text-rose-200">
            {error}
          </section>
        ) : data ? (
          <>
            <nav className="sticky top-3 z-10 rounded-3xl border border-zinc-800 bg-zinc-950/90 p-2 shadow-xl backdrop-blur-xl">
              <div className="grid gap-2 sm:grid-cols-3">
                {moduleTabs.map((item) => {
                  const isActive = activeModule === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveModule(item.id)}
                      className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold transition-colors ${
                        isActive
                          ? "border-cyan-400/30 bg-cyan-500/15 text-cyan-100"
                          : "border-transparent text-zinc-400 hover:border-zinc-800 hover:bg-zinc-900/80 hover:text-white"
                      }`}
                    >
                      <span>{item.label}</span>
                      {item.badge !== "" && item.badge !== undefined ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] ${
                            isActive
                              ? "bg-cyan-300/15 text-cyan-100"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {item.badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </nav>

            {activeModule === "resumen" ? (
            <section className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
              <div className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-6">
                <div className="flex flex-col gap-4 border-b border-zinc-800 pb-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                      Cliente
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-white">
                      {data.cliente.nombre}
                    </h2>
                    <p className="mt-2 text-sm text-zinc-400">
                      {data.cliente.entidad_nombre}
                      {data.cliente.rfc ? ` | RFC ${data.cliente.rfc}` : ""}
                    </p>
                    <div className="mt-4 grid gap-2 text-sm text-zinc-400 sm:grid-cols-2">
                      <p>
                        <span className="text-zinc-500">Correo:</span>{" "}
                        {data.cliente.correo || "Pendiente"}
                      </p>
                      <p>
                        <span className="text-zinc-500">Telefono:</span>{" "}
                        {data.cliente.telefono || "Pendiente"}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 lg:min-w-64">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                      Siguiente accion
                    </p>
                    {priorityAccount ? (
                      <>
                        <p className="mt-2 text-sm font-medium text-white">
                          {priorityAccount.concepto}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Vence {formatDate(priorityAccount.fecha_vencimiento)}
                        </p>
                        {dueDistanceLabel(priorityAccount.fecha_vencimiento) ? (
                          <p className="mt-2 text-xs font-medium text-cyan-100">
                            {dueDistanceLabel(priorityAccount.fecha_vencimiento)}
                          </p>
                        ) : null}
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <span
                            className={`rounded-full border px-3 py-1 text-xs ${categoryBadgeClass(
                              priorityAccount.categoria_tablero
                            )}`}
                          >
                            {categoryLabel(priorityAccount.categoria_tablero)}
                          </span>
                          <span className="text-sm font-semibold text-cyan-100">
                            {formatCurrency(priorityAccount.total_a_pagar)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <p className="mt-2 text-sm text-emerald-200">
                        Sin cuentas abiertas por pagar.
                      </p>
                    )}
                  </div>
                </div>
                {accountStatus ? (
                  <div className={`mt-5 rounded-2xl border p-4 ${accountStatus.className}`}>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold">{accountStatus.label}</p>
                        <p className="mt-1 text-sm opacity-85">{accountStatus.description}</p>
                      </div>
                      <p className="text-2xl font-semibold">
                        {formatCurrency(data.resumen.saldo_vivo)}
                      </p>
                    </div>
                  </div>
                ) : null}
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                      Saldo vivo
                    </p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {formatCurrency(data.resumen.saldo_vivo)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                      Recargos activos
                    </p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {formatCurrency(data.resumen.recargos_activos)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                      Cuentas por pagar
                    </p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {openAccounts.length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                      Pagado historico
                    </p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {formatCurrency(data.resumen.total_pagado)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-6">
                <div className="border-b border-zinc-800 pb-4">
                  <h3 className="text-xl font-semibold text-white">
                    Historial y comportamiento
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    Resumen de pagos, saldos y comportamiento reciente.
                  </p>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                      Puntualidad
                    </p>
                    <p className="mt-2 text-lg font-semibold text-white">
                      {formatPercent(data.resumen.puntualidad_porcentaje)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                      Morosidad
                    </p>
                    <p className="mt-2 text-lg font-semibold text-white">
                      {formatPercent(data.resumen.morosidad_porcentaje)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {data.pagos_recientes.slice(0, 3).length === 0 ? (
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-500">
                      Aun no hay pagos recientes registrados.
                    </div>
                  ) : (
                    data.pagos_recientes.slice(0, 3).map((payment) => (
                      <div
                        key={payment.id}
                        className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-white">{payment.concepto}</p>
                            <p className="text-xs text-zinc-500">
                              {formatDate(payment.fecha_pago)} | {payment.metodo}
                            </p>
                          </div>
                          <p className="font-semibold text-emerald-100">
                            {formatCurrency(payment.monto)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
            ) : null}

            {activeModule === "pago" ? (
            <section className="rounded-3xl border border-cyan-500/20 bg-cyan-500/10 p-6">
              <div className="border-b border-cyan-300/20 pb-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">
                  Transferencia
                </p>
                <h3 className="mt-2 text-xl font-semibold text-white">
                  Datos para realizar tu pago
                </h3>
                <p className="mt-1 text-sm text-cyan-100/70">
                  Usa la referencia indicada para que el equipo pueda identificar tu pago.
                </p>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-4">
                {renderTransferValue(
                  "Beneficiario",
                  data.transferencia.beneficiario,
                  "beneficiario"
                )}
                {renderTransferValue("Banco", data.transferencia.banco, "banco")}
                {renderTransferValue("CLABE", data.transferencia.clabe, "clabe")}
                {renderTransferValue(
                  "Referencia",
                  data.transferencia.referencia,
                  "referencia"
                )}
              </div>
            </section>
            ) : null}

            {activeModule === "pago" || activeModule === "facturas" ? (
            <section className="grid gap-4">
              {activeModule === "pago" ? (
              <div className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-6">
                <div className="border-b border-zinc-800 pb-4">
                  <h3 className="text-xl font-semibold text-white">
                    Cargar comprobante
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    Envia una imagen o PDF legible. BetterP leera monto, fecha,
                    referencia y banco automaticamente; si no se alcanza a leer,
                    administracion lo revisara o te pedira un archivo mas claro.
                  </p>
                </div>
                <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-50">
                  <p className="font-semibold text-white">
                    Solo necesitas subir el comprobante.
                  </p>
                  <p className="mt-2 text-cyan-100/80">
                    Procura que se vean completos el importe transferido, fecha,
                    folio o referencia, banco y beneficiario. No es necesario que
                    captures el monto ni selecciones una cuenta por pagar.
                  </p>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <FieldLabel
                      label="Archivo"
                      required
                      info={PORTAL_FIELD_INFO.archivo}
                      onInfo={setFieldInfo}
                    />
                    <input
                      key={uploadFileKey}
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp"
                      disabled={uploading}
                      onChange={(event) => {
                        clearUploadFieldError("archivo");
                        setUploadError("");
                        setUploadMessage("");
                        setUploadFile(event.target.files?.[0] || null);
                      }}
                      className={`w-full rounded-2xl border bg-zinc-950 px-4 py-2.5 text-sm text-zinc-300 outline-none transition file:mr-3 file:rounded-xl file:border-0 file:bg-cyan-500/15 file:px-3 file:py-2 file:text-cyan-100 focus:ring-1 ${
                        uploadFormErrors.archivo
                          ? "border-rose-400/60 focus:border-rose-400 focus:ring-rose-400"
                          : "border-zinc-800 focus:border-cyan-400 focus:ring-cyan-400"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    />
                    <FieldFeedback
                      error={uploadFormErrors.archivo}
                      helper="PDF, PNG, JPG, JPEG o WEBP. Maximo 10 MB. Usa una captura clara y sin recortes importantes."
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <FieldLabel
                      label="Comentarios para revision"
                      info={PORTAL_FIELD_INFO.notas}
                      onInfo={setFieldInfo}
                    />
                    <textarea
                      value={uploadNotas}
                      maxLength={300}
                      disabled={uploading}
                      onChange={(event) => {
                        clearUploadFieldError("notas");
                        setUploadNotas(sanitizePortalNotes(event.target.value));
                      }}
                      rows={3}
                      placeholder="Ej. transferencia parcial, pago agrupado o aclaracion."
                      className={`${fieldClass(uploadFormErrors.notas)} resize-none disabled:cursor-not-allowed disabled:opacity-60`}
                    />
                    <FieldFeedback
                      error={uploadFormErrors.notas}
                      helper={`${uploadNotas.length}/300 caracteres.`}
                    />
                  </div>
                </div>
                {uploadError && (
                  <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                    {uploadError}
                  </div>
                )}
                {uploadMessage && (
                  <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                    {uploadMessage}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void submitComprobante()}
                  disabled={uploading}
                  className="mt-5 w-full rounded-2xl border border-cyan-500/30 bg-cyan-500/15 px-5 py-3 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {uploading ? "Procesando comprobante..." : "Subir comprobante"}
                </button>
              </div>
              ) : null}

              {activeModule === "facturas" ? (
              <div className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-6">
                <div className="border-b border-zinc-800 pb-4">
                  <h3 className="text-xl font-semibold text-white">
                    Facturas disponibles
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    Descarga CFDI emitidos cuando esten disponibles. Si no hay
                    factura, el estado de cuenta funciona como referencia de pago.
                  </p>
                </div>
                <div className="mt-4 space-y-3">
                  {invoiceError ? (
                    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                      {invoiceError}
                    </div>
                  ) : null}
                  {invoiceMessage ? (
                    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                      {invoiceMessage}
                    </div>
                  ) : null}
                  {renderListFilters(
                    invoiceSearch,
                    setInvoiceSearch,
                    invoiceStatusFilter,
                    setInvoiceStatusFilter,
                    [
                      { value: "TODOS", label: "Todas" },
                      { value: "TIMBRADA", label: "Timbradas" },
                      { value: "BORRADOR", label: "Borrador" },
                      { value: "ERROR", label: "Error" },
                    ],
                    "Buscar por folio o UUID"
                  )}
                  {filteredInvoices.length === 0 ? (
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-500">
                      No hay facturas para los filtros seleccionados.
                    </div>
                  ) : (
                    pagedInvoices.map((invoice) => (
                      <div
                        key={invoice.id}
                        className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-medium text-white">
                              {invoiceFolio(invoice)}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {invoice.estatus}
                              {invoice.uuid ? ` | UUID ${invoice.uuid}` : ""}
                            </p>
                          </div>
                          {renderInvoiceDownloadActions(invoice, { alignEnd: true })}
                        </div>
                      </div>
                    ))
                  )}
                  {renderPagination(invoicePage, invoiceTotalPages, setInvoicePage)}
                </div>
              </div>
              ) : null}
            </section>
            ) : null}

            {activeModule === "pago" ? (
            <section className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-6">
              <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-white">
                    Comprobantes enviados
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    Aqui aparecen los archivos recibidos y su estado de revision.
                    Estos acuses no sustituyen una factura fiscal.
                  </p>
                </div>
                <span className="rounded-full border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-300">
                  {filteredEvidence.length} registro(s)
                </span>
              </div>
              {renderListFilters(
                evidenceSearch,
                setEvidenceSearch,
                evidenceStatusFilter,
                setEvidenceStatusFilter,
                [
                  { value: "TODOS", label: "Todos" },
                  { value: "NUEVA", label: "En revision" },
                  { value: "VALIDADA", label: "Validado" },
                  { value: "APLICADA", label: "Aplicado" },
                  { value: "DESCARTADA", label: "Descartado" },
                ],
                "Buscar por archivo o referencia"
              )}
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {filteredEvidence.length === 0 ? (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-500">
                    No hay comprobantes para los filtros seleccionados.
                  </div>
                ) : (
                  pagedEvidence.map((evidence) => (
                    <div
                      key={evidence.id}
                      className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-medium text-white">
                            {evidence.archivo_nombre || `Comprobante ${evidence.id}`}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            Enviado {formatDate(evidence.fecha_registro)}
                            {evidence.fecha_pago_reportada
                              ? ` | Pago ${formatDate(evidence.fecha_pago_reportada)}`
                              : ""}
                          </p>
                        </div>
                        <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100">
                          {evidenceStatusLabel(evidence.estatus)}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                            Monto
                          </p>
                          <p className="mt-1 font-medium text-white">
                            {formatCurrency(evidence.monto_reportado || 0)}
                          </p>
                        </div>
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                            Referencia
                          </p>
                          <p className="mt-1 font-medium text-white">
                            {evidence.referencia_reportada || "Sin referencia"}
                          </p>
                        </div>
                      </div>
                      <p className="mt-3 text-sm text-zinc-400">{evidence.mensaje}</p>
                    </div>
                  ))
                )}
              </div>
              {renderPagination(evidencePage, evidenceTotalPages, setEvidencePage)}
            </section>
            ) : null}

            {activeModule === "facturas" ? (
            <section className="grid gap-4">
              <div className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-6">
                <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-semibold text-white">Datos fiscales</h3>
                      <InfoButton
                        info={PORTAL_FIELD_INFO.csf_file}
                        onInfo={setFieldInfo}
                      />
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">
                      Informacion registrada para emitir CFDI. Puede ser distinta a
                      la persona que ocupa o renta el espacio.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={csfInputRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      className="hidden"
                      onChange={(event) => void submitCsf(event.target.files?.[0])}
                    />
                    {data.datos_fiscales.archivo_csf_url ? (
                      <a
                        href={data.datos_fiscales.archivo_csf_url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Ver CSF"
                        title="Ver CSF"
                        className={successIconButton}
                      >
                        <EyeIcon />
                        {renderTooltip("Ver CSF")}
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (!csfRecipientScope) {
                          const message =
                            "Indica si los datos fiscales pertenecen al ocupante o a otra persona/empresa.";
                          setCsfFormErrors((current) => ({ ...current, scope: message }));
                          setCsfError(message);
                          return;
                        }
                        clearCsfFieldError("archivo");
                        csfInputRef.current?.click();
                      }}
                      disabled={csfUploading || csfDeleting}
                      aria-label={
                        data.datos_fiscales.archivo_csf_url
                          ? "Cambiar CSF"
                          : "Cargar CSF"
                      }
                      title={
                        data.datos_fiscales.archivo_csf_url
                          ? "Cambiar CSF"
                          : "Cargar CSF"
                      }
                      className={primaryIconButton}
                    >
                      <UploadIcon />
                      {renderTooltip(
                        csfUploading
                          ? "Cargando CSF"
                          : data.datos_fiscales.archivo_csf_url
                            ? "Cambiar CSF"
                            : "Cargar CSF"
                      )}
                    </button>
                    {data.datos_fiscales.archivo_csf_url ? (
                      <button
                        type="button"
                        onClick={() => void deleteCsf()}
                        disabled={csfUploading || csfDeleting}
                        aria-label="Quitar CSF"
                        title="Quitar CSF"
                        className={dangerIconButton}
                      >
                        <TrashIcon />
                        {renderTooltip(csfDeleting ? "Quitando CSF" : "Quitar CSF")}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 rounded-2xl border border-cyan-400/15 bg-cyan-500/10 p-4">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-cyan-100">
                      Antes de cargar la CSF
                    </p>
                    <InfoButton
                      info={PORTAL_FIELD_INFO.csf_scope}
                      onInfo={setFieldInfo}
                    />
                  </div>
                  <p className="mt-1 text-sm text-cyan-100/75">
                    Confirma si estos datos fiscales corresponden al ocupante
                    registrado o a otra persona/empresa que recibira la factura.
                    Esto no cambiara el nombre visible del cliente en el portal.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label
                      className={`cursor-pointer rounded-2xl border p-3 text-sm transition-colors ${
                        csfRecipientScope === "same"
                          ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-50"
                          : "border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:border-zinc-700"
                      }`}
                    >
                      <input
                        type="radio"
                        name="csf-recipient-scope"
                        value="same"
                        checked={csfRecipientScope === "same"}
                        onChange={() => {
                          clearCsfFieldError("scope");
                          setCsfRecipientScope("same");
                        }}
                        className="mr-2"
                      />
                      Son los mismos datos del ocupante
                    </label>
                    <label
                      className={`cursor-pointer rounded-2xl border p-3 text-sm transition-colors ${
                        csfRecipientScope === "different"
                          ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-50"
                          : "border-zinc-800 bg-zinc-950/70 text-zinc-300 hover:border-zinc-700"
                      }`}
                    >
                      <input
                        type="radio"
                        name="csf-recipient-scope"
                        value="different"
                        checked={csfRecipientScope === "different"}
                        onChange={() => {
                          clearCsfFieldError("scope");
                          setCsfRecipientScope("different");
                        }}
                        className="mr-2"
                      />
                      Son datos fiscales de otra persona o empresa
                    </label>
                  </div>
                  <FieldFeedback error={csfFormErrors.scope} />
                  <FieldFeedback error={csfFormErrors.archivo} />
                </div>
                <div className="mt-4 grid gap-3 text-sm text-zinc-300">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                        Nombre / razon social
                      </p>
                      <InfoButton
                        info={PORTAL_FIELD_INFO.fiscal_razon_social}
                        onInfo={setFieldInfo}
                      />
                    </div>
                    <p className="mt-1 font-medium text-white">
                      {data.datos_fiscales.razon_social || "Pendiente"}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                          RFC
                        </p>
                        <InfoButton
                          info={PORTAL_FIELD_INFO.fiscal_rfc}
                          onInfo={setFieldInfo}
                        />
                      </div>
                      <p className="mt-1 font-medium text-white">
                        {data.datos_fiscales.rfc || "Pendiente"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                          Codigo postal
                        </p>
                        <InfoButton
                          info={PORTAL_FIELD_INFO.fiscal_codigo_postal}
                          onInfo={setFieldInfo}
                        />
                      </div>
                      <p className="mt-1 font-medium text-white">
                        {data.datos_fiscales.codigo_postal || "Pendiente"}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                        Regimen fiscal
                      </p>
                      <InfoButton
                        info={PORTAL_FIELD_INFO.fiscal_regimen}
                        onInfo={setFieldInfo}
                      />
                    </div>
                    <p className="mt-1 font-medium text-white">
                      {data.datos_fiscales.regimen_fiscal || "Pendiente"}
                    </p>
                  </div>
                  {fiscalRegimePendingSelection ? (
                    <div className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4">
                      <p className="text-sm font-semibold text-amber-100">
                        Selecciona el regimen para timbrar
                      </p>
                      <p className="mt-1 text-sm leading-6 text-amber-100/75">
                        Tu constancia muestra mas de un regimen activo. Para evitar
                        rechazos fiscales, confirma con cual debe emitirse el CFDI.
                      </p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <select
                          value={selectedFiscalRegime}
                          onChange={(event) => {
                            setSelectedFiscalRegime(event.target.value);
                            setCsfError("");
                          }}
                          disabled={savingFiscalRegime}
                          className="min-h-12 flex-1 rounded-2xl border border-amber-300/30 bg-zinc-950 px-4 text-sm text-white outline-none transition-colors focus:border-amber-200"
                        >
                          <option value="">Selecciona un regimen fiscal</option>
                          {detectedFiscalRegimes.map((option) => {
                            const value = fiscalRegimeOptionValue(option);
                            return (
                              <option key={value} value={value}>
                                {fiscalRegimeOptionLabel(option)}
                              </option>
                            );
                          })}
                        </select>
                        <button
                          type="button"
                          onClick={() => void confirmFiscalRegime()}
                          disabled={savingFiscalRegime || !selectedFiscalRegime}
                          className="rounded-2xl border border-amber-300/30 bg-amber-500/15 px-5 py-3 text-sm font-semibold text-amber-50 transition-colors hover:border-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingFiscalRegime ? "Guardando..." : "Confirmar regimen"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div
                    className={`rounded-2xl border p-4 text-sm ${
                      data.datos_fiscales.archivo_csf_url
                        ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                        : "border-amber-400/20 bg-amber-500/10 text-amber-100"
                    }`}
                  >
                    {data.datos_fiscales.archivo_csf_url
                      ? fiscalRegimePendingSelection
                        ? "CSF cargada. Falta confirmar el regimen fiscal antes de emitir CFDI."
                        : "CSF cargada. Estos datos se usaran para emitir tus CFDI cuando aplique."
                      : "Si necesitas factura, carga tu CSF en PDF para completar RFC, razon social, regimen y codigo postal."}
                  </div>
                  {csfMessage ? (
                    <div className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                      {csfMessage}
                    </div>
                  ) : null}
                  {csfError ? (
                    <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 p-4 text-sm text-rose-100">
                      {csfError}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
            ) : null}

            {activeModule === "resumen" ? (
            <section className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-6">
              <div className="flex items-end justify-between gap-4 border-b border-zinc-800 pb-4">
                <div>
                  <h3 className="text-xl font-semibold text-white">
                    Cuentas abiertas
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    Consulta vencimientos, periodo de gracia y total por concepto.
                  </p>
                </div>
                <div className="rounded-full border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-300">
                  {filteredAccounts.length} registros
                </div>
              </div>
              {renderListFilters(
                accountSearch,
                setAccountSearch,
                accountStatusFilter,
                setAccountStatusFilter,
                [
                  { value: "TODOS", label: "Todos" },
                  { value: "POR_VENCER", label: "Por vencer" },
                  { value: "EN_GRACIA", label: "En gracia" },
                  { value: "VENCIDA_CON_RECARGO", label: "Vencida" },
                  { value: "PAGADA", label: "Pagada" },
                ],
                "Buscar por concepto o espacio"
              )}
              <div className="mt-4 grid gap-3 md:hidden">
                {filteredAccounts.length === 0 ? (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-500">
                    No hay cuentas para los filtros seleccionados.
                  </div>
                ) : (
                  pagedAccounts.map((cuenta) => (
                    <div
                      key={cuenta.id}
                      className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{cuenta.concepto}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {cuenta.espacio_codigo || "Sin espacio"}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-3 py-1 text-xs ${categoryBadgeClass(
                            cuenta.categoria_tablero
                          )}`}
                        >
                          {categoryLabel(cuenta.categoria_tablero)}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-zinc-500">Vence</span>
                          <span className="text-zinc-200">
                            {formatDate(cuenta.fecha_vencimiento)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-zinc-500">Limite de gracia</span>
                          <span className="text-zinc-200">
                            {formatDate(cuenta.fecha_limite_gracia)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-zinc-500">Base</span>
                          <span className="text-zinc-200">
                            {formatCurrency(cuenta.monto_base)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-zinc-500">Recargo</span>
                          <span className="text-zinc-200">
                            {formatCurrency(cuenta.interes_monto)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-3">
                          <span className="font-medium text-white">Total</span>
                          <span className="text-lg font-semibold text-white">
                            {formatCurrency(cuenta.total_a_pagar)}
                          </span>
                        </div>
                      </div>
                      {cuenta.factura ? (
                        <div className="mt-4">
                          {renderInvoiceDownloadActions(cuenta.factura, { cuenta })}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void requestInvoice(cuenta)}
                          disabled={invoiceIssuingId === cuenta.id}
                          className={`mt-4 ${primaryActionButton}`}
                        >
                          {invoiceIssuingId === cuenta.id ? "Generando..." : "Generar factura"}
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className="mt-4 hidden overflow-x-auto md:block">
                <table className="min-w-full text-left text-sm text-zinc-300">
                  <thead className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    <tr>
                      <th className="px-3 py-3">Concepto</th>
                      <th className="px-3 py-3">Vence</th>
                      <th className="px-3 py-3">Gracia</th>
                      <th className="px-3 py-3">Base</th>
                      <th className="px-3 py-3">Recargo</th>
                      <th className="px-3 py-3">Total</th>
                      <th className="px-3 py-3">Estatus</th>
                      <th className="px-3 py-3">Factura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAccounts.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-3 py-10 text-center text-zinc-500"
                        >
                          No hay cuentas para los filtros seleccionados.
                        </td>
                      </tr>
                    ) : (
                      pagedAccounts.map((cuenta) => (
                        <tr key={cuenta.id} className="border-t border-zinc-900">
                          <td className="px-3 py-4">
                            <div className="font-medium text-white">{cuenta.concepto}</div>
                            <div className="text-xs text-zinc-500">
                              {cuenta.espacio_codigo || "Sin espacio"}
                            </div>
                          </td>
                          <td className="px-3 py-4">{formatDate(cuenta.fecha_vencimiento)}</td>
                          <td className="px-3 py-4">
                            {formatDate(cuenta.fecha_limite_gracia)}
                          </td>
                          <td className="px-3 py-4">{formatCurrency(cuenta.monto_base)}</td>
                          <td className="px-3 py-4">{formatCurrency(cuenta.interes_monto)}</td>
                          <td className="px-3 py-4 font-medium text-white">
                            {formatCurrency(cuenta.total_a_pagar)}
                          </td>
                          <td className="px-3 py-4">
                            <span
                              className={`rounded-full border px-3 py-1 text-xs ${categoryBadgeClass(
                                cuenta.categoria_tablero
                              )}`}
                            >
                              {categoryLabel(cuenta.categoria_tablero)}
                            </span>
                          </td>
                          <td className="px-3 py-4">
                            {cuenta.factura ? (
                              renderInvoiceDownloadActions(cuenta.factura, {
                                cuenta,
                                compact: true,
                              })
                            ) : (
                              <button
                                type="button"
                                onClick={() => void requestInvoice(cuenta)}
                                disabled={invoiceIssuingId === cuenta.id}
                                className={`${primaryActionButton} px-2.5 py-1`}
                              >
                                {invoiceIssuingId === cuenta.id ? "Generando..." : "Generar"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {renderPagination(accountPage, accountTotalPages, setAccountPage)}
            </section>
            ) : null}
          </>
        ) : null}
      </div>
      )}
      {!consentGate && invoiceDialog ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invoice-notice-title"
        >
          <div className="w-full max-w-md rounded-3xl border border-cyan-400/20 bg-zinc-950 p-6 shadow-2xl">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${
                invoiceDialog.variant === "error"
                  ? "border-rose-400/25 bg-rose-500/10 text-rose-100"
                  : invoiceDialog.variant === "warning"
                    ? "border-amber-400/25 bg-amber-500/10 text-amber-100"
                    : "border-cyan-400/25 bg-cyan-500/10 text-cyan-100"
              }`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
                <path
                  d="M12 9v4m0 4h.01M10.3 4.7 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.7a2 2 0 0 0-3.4 0Z"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
            </div>
            <h2 id="invoice-notice-title" className="mt-4 text-xl font-semibold text-white">
              {invoiceDialog.title}
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              {invoiceDialog.message}
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              {invoiceDialog.actionLabel && invoiceDialog.actionModule ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveModule(invoiceDialog.actionModule!);
                    setInvoiceDialog(null);
                  }}
                  className={primaryActionButton}
                >
                  {invoiceDialog.actionLabel}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setInvoiceDialog(null);
                }}
                className={secondaryActionButton}
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
