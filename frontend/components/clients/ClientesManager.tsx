"use client";

import { buildApiUrl } from '@/lib/api';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ClienteFormModal, {
  type ClienteDetail,
  type ClienteEntityOption,
  type ClienteModalMode,
} from "./ClienteFormModal";

interface ClienteListItem {
  id: number;
  entidad_id: number;
  identificador?: string | null;
  nombre: string;
  razon_social: string;
  nombre_comercial?: string | null;
  rfc: string;
  entidad: string;
  saldo: number;
  estatus: string;
  datosFiscalesCompletos: boolean;
  correo_principal?: string | null;
  telefono: string;
  activo: boolean;
  tiene_asignacion_activa?: boolean;
  asignacion_activa_id?: number | null;
  espacio_asignado_codigo?: string | null;
  contrato_digital_url?: string | null;
  contrato_digital_nombre?: string | null;
  contrato_digital_cargado?: boolean;
  consentimiento_cobranza_aceptado?: boolean;
  consentimiento_cobranza_fecha?: string | null;
  no_contactar_cobranza?: boolean;
  no_contactar_cobranza_motivo?: string | null;
  no_contactar_cobranza_fecha?: string | null;
}

interface ClientesListResponse {
  items: ClienteListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  entidades: ClienteEntityOption[];
}

interface BatchImportResult {
  mensaje: string;
  total_filas: number;
  clientes_creados: number;
  clientes_actualizados: number;
  filas_omitidas: number;
  errores: string[];
}

interface BatchImportAccepted {
  accepted: boolean;
  job_id: number;
  status: string;
  mensaje: string;
}

interface BackgroundJobStatus {
  id: number;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "ERROR" | "CANCELLED";
  result?: BatchImportResult;
  error?: string | null;
}

interface PortalPreviewCuenta {
  id: number;
  concepto: string;
  espacio_codigo?: string | null;
  fecha_vencimiento?: string | null;
  fecha_limite_gracia?: string | null;
  monto_base?: number;
  interes_monto?: number;
  total_a_pagar?: number;
  categoria_tablero?: string;
}

interface PortalPreviewPago {
  id: number;
  concepto: string;
  monto: number;
  fecha_pago?: string | null;
  metodo?: string | null;
  referencia?: string | null;
}

interface PortalPreviewFactura {
  id: number;
  estatus: string;
  serie?: string | null;
  folio?: string | null;
  uuid?: string | null;
  total: number;
  fecha_emision?: string | null;
  pdf_url?: string | null;
  xml_url?: string | null;
}

interface PortalPreviewBehavior {
  pagadas_a_tiempo: number;
  pagadas_en_gracia: number;
  pagadas_tarde: number;
  abiertas_por_vencer: number;
  abiertas_en_gracia: number;
  abiertas_vencidas: number;
}

interface PortalPreviewTrend {
  periodo?: string | null;
  label: string;
  facturado: number;
  pagado: number;
  pendiente: number;
}

interface PortalPreviewPayload {
  cliente: {
    id: number;
    nombre: string;
    entidad_nombre?: string | null;
    rfc?: string | null;
    correo?: string | null;
    telefono?: string | null;
  };
  resumen: {
    saldo_vivo: number;
    recargos_activos: number;
    total_pagado: number;
    total_facturado: number;
    puntualidad_porcentaje?: number;
    morosidad_porcentaje?: number;
    score_pago: number;
    score_label: string;
    cuentas_totales: number;
    cuentas_vencidas_abiertas: number;
    cuentas_en_gracia: number;
  };
  comportamiento?: PortalPreviewBehavior;
  tendencia_periodos?: PortalPreviewTrend[];
  cuentas: PortalPreviewCuenta[];
  pagos_recientes: PortalPreviewPago[];
  facturas_recientes?: PortalPreviewFactura[];
  portal: {
    url?: string | null;
    token_horas?: number;
  };
  facturacion: {
    activa: boolean;
    pac_proveedor?: string | null;
    uso_cfdi_default?: string | null;
    metodo_pago_default?: string | null;
    forma_pago_default?: string | null;
  };
  transferencia: {
    beneficiario?: string | null;
    banco?: string | null;
    clabe?: string | null;
    referencia?: string | null;
  };
  datos_fiscales: {
    rfc?: string | null;
    razon_social?: string | null;
    regimen_fiscal?: string | null;
    codigo_postal?: string | null;
    correo?: string | null;
    archivo_csf_url?: string | null;
  };
}

interface PortalCsfUploadResponse {
  success: boolean;
  mensaje?: string;
  portal?: PortalPreviewPayload;
  detail?: string;
}

interface DeleteModalState {
  isOpen: boolean;
  ids: number[];
  nombres: string[];
}

interface EspacioAsignacionOption {
  id: number;
  codigo: string;
  estatus: string;
  tipo_nombre?: string | null;
  renta_sugerida?: number | null;
  deposito_sugerido?: number | null;
  cliente_actual_id?: number | null;
  cliente_actual_nombre?: string | null;
  asignacion_activa_id?: number | null;
  ocupacion_desde?: string | null;
}

type AssignmentIntent = "manage" | "end";

interface AssignmentModalState {
  isOpen: boolean;
  intent: AssignmentIntent;
  cliente: ClienteListItem | null;
  espacios: EspacioAsignacionOption[];
  isLoading: boolean;
  isSaving: boolean;
  error: string;
  selectedEntityId: number;
  selectedSpaceId: string;
  fechaInicio: string;
  fechaFin: string;
  observaciones: string;
}

interface ContractModalState {
  isOpen: boolean;
  cliente: ClienteListItem | null;
  file: File | null;
  isUploading: boolean;
  error: string;
}

const CRM_API_BASE = buildApiUrl("/crm");
const ESPACIOS_API_BASE = buildApiUrl("/espacios");
const CONTRACT_MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const CONTRACT_ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"];

function getErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }
  return fallback;
}

function extractFilename(contentDisposition: string | null, fallback: string) {
  if (!contentDisposition) {
    return fallback;
  }
  const match = contentDisposition.match(/filename="([^"]+)"/i);
  return match?.[1] || fallback;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatPercent(value?: number | null) {
  return `${new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value || 0)}%`;
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Sin fecha";
  }
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function todayLocalDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

function validateContractFile(file: File) {
  const lowerName = file.name.toLowerCase();
  const hasAllowedExtension = CONTRACT_ALLOWED_EXTENSIONS.some((extension) =>
    lowerName.endsWith(extension)
  );
  if (!hasAllowedExtension) {
    return "El contrato debe ser PDF, Word o imagen (.pdf, .doc, .docx, .jpg, .jpeg, .png).";
  }
  if (file.size > CONTRACT_MAX_FILE_SIZE_BYTES) {
    return "El contrato no puede superar 15 MB.";
  }
  return "";
}

function findActiveClientAssignment(
  espacios: EspacioAsignacionOption[],
  clienteId?: number
) {
  if (!clienteId) {
    return null;
  }
  return (
    espacios.find(
      (space) =>
        space.cliente_actual_id === clienteId && Boolean(space.asignacion_activa_id)
    ) || null
  );
}

function buildClienteEntityUpdatePayload(
  cliente: ClienteDetail,
  entidadId: number
) {
  return {
    entidad_relacionada_id: entidadId,
    es_persona_moral: cliente.es_persona_moral,
    nombre_comercial: cliente.nombre_comercial || "",
    razon_social: cliente.razon_social || "",
    rfc: cliente.rfc || "",
    regimen_fiscal: cliente.regimen_fiscal || "",
    identificador: cliente.identificador || "",
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
    dia_corte_individual: cliente.dia_corte_individual ?? null,
    dias_gracia: cliente.dias_gracia ?? 0,
    activo: cliente.activo,
  };
}

function buildPortalInvoiceDownloadUrl(
  portalUrl: string | null | undefined,
  invoiceId: number,
  format: "pdf" | "xml",
) {
  const match = portalUrl?.match(/\/portal-cliente\/([^/?#]+)/);
  const token = match?.[1];
  if (!token) {
    return "";
  }
  return buildApiUrl(`/comunicaciones/portal/${token}/facturas/${invoiceId}/${format}/`);
}

function portalStatusLabel(value?: string | null) {
  switch (value) {
    case "POR_VENCER":
      return "Por vencer";
    case "EN_GRACIA":
      return "En gracia";
    case "VENCIDA_CON_RECARGO":
      return "Vencida";
    case "PAGADA":
      return "Pagada";
    default:
      return value || "Abierta";
  }
}

function firstOpenPortalAccount(cuentas: PortalPreviewCuenta[]) {
  return cuentas.find((cuenta) => cuenta.categoria_tablero !== "PAGADA") || null;
}

type ClienteDisplayInput = Pick<
  ClienteListItem,
  "nombre" | "razon_social" | "nombre_comercial" | "rfc" | "identificador"
>;

function cleanDisplayText(value?: string | null) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function normalizeComparableText(value?: string | null) {
  return cleanDisplayText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function looksLikeFiscalHeaderNoise(value?: string | null) {
  const text = normalizeComparableText(value);
  return (
    text.includes("idcif") ||
    text.includes("valida tu informacion fiscal") ||
    text.includes("datos de identificacion del contribuyente") ||
    text.includes("constancia de situacion fiscal")
  );
}

function getClienteDisplayName(cliente: ClienteDisplayInput) {
  const validName = [cliente.nombre_comercial, cliente.nombre, cliente.razon_social]
    .map(cleanDisplayText)
    .find((value) => value && !looksLikeFiscalHeaderNoise(value));

  return (
    validName ||
    cleanDisplayText(cliente.rfc) ||
    cleanDisplayText(cliente.identificador) ||
    "Cliente sin nombre"
  );
}

export default function ClientesManager() {
  const batchInputRef = useRef<HTMLInputElement | null>(null);
  const portalCsfInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedClients, setSelectedClients] = useState<number[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ClienteModalMode>("create");
  const [clienteModalData, setClienteModalData] = useState<ClienteDetail | null>(
    null
  );
  const [isLoadingClientes, setIsLoadingClientes] = useState(true);
  const [clientesError, setClientesError] = useState("");
  const [filtroEntidadId, setFiltroEntidadId] = useState("Todas");
  const [filtroContrato, setFiltroContrato] = useState("Activo");
  const [filtroDatos, setFiltroDatos] = useState("Todos");
  const [paginaActual, setPaginaActual] = useState(1);
  const [itemsPorPagina, setItemsPorPagina] = useState(20);
  const [clientesData, setClientesData] = useState<ClientesListResponse | null>(
    null
  );
  const [isLoadingDetailId, setIsLoadingDetailId] = useState<number | null>(null);
  const [isLoadingPortalId, setIsLoadingPortalId] = useState<number | null>(null);
  const [portalPreview, setPortalPreview] = useState<PortalPreviewPayload | null>(
    null
  );
  const [portalPreviewError, setPortalPreviewError] = useState("");
  const [portalCsfUploading, setPortalCsfUploading] = useState(false);
  const [reactivatingClientId, setReactivatingClientId] = useState<number | null>(
    null
  );
  const [mensajeExito, setMensajeExito] = useState("");
  const [modalBorrado, setModalBorrado] = useState<DeleteModalState>({
    isOpen: false,
    ids: [],
    nombres: [],
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [assignmentModal, setAssignmentModal] = useState<AssignmentModalState>({
    isOpen: false,
    intent: "manage",
    cliente: null,
    espacios: [],
    isLoading: false,
    isSaving: false,
    error: "",
    selectedEntityId: 0,
    selectedSpaceId: "",
    fechaInicio: todayLocalDate(),
    fechaFin: todayLocalDate(),
    observaciones: "",
  });
  const [contractModal, setContractModal] = useState<ContractModalState>({
    isOpen: false,
    cliente: null,
    file: null,
    isUploading: false,
    error: "",
  });
  const [contractInputKey, setContractInputKey] = useState(0);
  const [loadingAssignmentClientId, setLoadingAssignmentClientId] = useState<
    number | null
  >(null);
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchInputKey, setBatchInputKey] = useState(0);
  const [batchError, setBatchError] = useState("");
  const [batchResult, setBatchResult] = useState<BatchImportResult | null>(null);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [isBatchImporting, setIsBatchImporting] = useState(false);
  const [mostrarBatch, setMostrarBatch] = useState(false);

  const clientes = clientesData?.items || [];
  const entidadesDisponibles = clientesData?.entidades || [];
  const totalClientes = clientesData?.total || 0;
  const totalPaginas = clientesData?.total_pages || 1;
  const currentPage = clientesData?.page || paginaActual;

  const showSuccess = useCallback((message: string) => {
    setMensajeExito(message);
    window.setTimeout(() => setMensajeExito(""), 3200);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  const fetchClientes = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoadingClientes(true);
      setClientesError("");

      try {
        const params = new URLSearchParams();
        params.set("page", String(paginaActual));
        params.set("page_size", String(itemsPorPagina));
        if (searchQuery) {
          params.set("search", searchQuery);
        }
        if (filtroEntidadId !== "Todas") {
          params.set("entidad_id", filtroEntidadId);
        }
        params.set("contrato", filtroContrato);
        if (filtroDatos === "Incompletos") {
          params.set("incompletos", "true");
        }

        const response = await fetch(
          `${CRM_API_BASE}/lista/?${params.toString()}`,
          {
            cache: "no-store",
            signal,
          }
        );
        const body = (await response.json().catch(() => ({}))) as
          | ClientesListResponse
          | { detail?: string };

        if (!response.ok) {
          throw new Error(
            getErrorMessage(body, "No se pudo cargar la lista de clientes.")
          );
        }

        const payload = body as ClientesListResponse;
        setClientesData(payload);
        if (payload.page !== paginaActual) {
          setPaginaActual(payload.page);
        }
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        setClientesData(null);
        setClientesError(
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los clientes."
        );
      } finally {
        if (!signal?.aborted) {
          setIsLoadingClientes(false);
        }
      }
    },
    [
      filtroContrato,
      filtroDatos,
      filtroEntidadId,
      itemsPorPagina,
      paginaActual,
      searchQuery,
    ]
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchClientes(controller.signal);
    return () => controller.abort();
  }, [fetchClientes]);

  useEffect(() => {
    setSelectedClients([]);
  }, [clientes]);

  const selectedClientNames = useMemo(() => {
    const namesById = new Map(
      clientes.map((cliente) => [cliente.id, getClienteDisplayName(cliente)])
    );
    return selectedClients.map((id) => namesById.get(id) || `Cliente ${id}`);
  }, [clientes, selectedClients]);

  const activeAssignment = useMemo(
    () =>
      findActiveClientAssignment(
        assignmentModal.espacios,
        assignmentModal.cliente?.id
      ),
    [assignmentModal.cliente?.id, assignmentModal.espacios]
  );

  const availableAssignmentSpaces = useMemo(
    () =>
      assignmentModal.espacios.filter(
        (space) =>
          space.estatus === "DISPONIBLE" &&
          !space.asignacion_activa_id &&
          !space.cliente_actual_id
      ),
    [assignmentModal.espacios]
  );

  const indiceInicial =
    totalClientes === 0 ? 0 : (currentPage - 1) * itemsPorPagina + 1;
  const indiceFinal = totalClientes === 0 ? 0 : indiceInicial + clientes.length - 1;

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedClients(clientes.map((cliente) => cliente.id));
      return;
    }
    setSelectedClients([]);
  };

  const handleSelectOne = (id: number) => {
    setSelectedClients((prev) =>
      prev.includes(id)
        ? prev.filter((clientId) => clientId !== id)
        : [...prev, id]
    );
  };

  const abrirModalNuevo = () => {
    setModalMode("create");
    setClienteModalData(null);
    setIsModalOpen(true);
  };

  const abrirModalConCliente = async (
    clientId: number,
    mode: Exclude<ClienteModalMode, "create">
  ) => {
    setIsLoadingDetailId(clientId);

    try {
      const response = await fetch(`${CRM_API_BASE}/cliente/${clientId}/`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as
        | ClienteDetail
        | { detail?: string };

      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo cargar el detalle del cliente.")
        );
      }

      setClienteModalData(body as ClienteDetail);
      setModalMode(mode);
      setIsModalOpen(true);
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "No se pudo abrir el detalle del cliente."
      );
    } finally {
      setIsLoadingDetailId(null);
    }
  };

  const abrirPortalPreview = async (clientId: number) => {
    setIsLoadingPortalId(clientId);
    setPortalPreview(null);
    setPortalPreviewError("");

    try {
      const response = await fetch(
        `${CRM_API_BASE}/cliente/${clientId}/portal-preview/`,
        { cache: "no-store" }
      );
      const body = (await response.json().catch(() => ({}))) as
        | PortalPreviewPayload
        | { detail?: string };

      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo cargar la vista del portal.")
        );
      }

      setPortalPreview(body as PortalPreviewPayload);
    } catch (error) {
      setPortalPreviewError(
        error instanceof Error
          ? error.message
          : "No se pudo cargar la vista del portal."
      );
    } finally {
      setIsLoadingPortalId(null);
    }
  };

  const cerrarPortalPreview = () => {
    setPortalPreview(null);
    setPortalPreviewError("");
    setPortalCsfUploading(false);
  };

  const cargarCsfPortal = async (file: File | null | undefined) => {
    if (!portalPreview || !file) {
      return;
    }
    setPortalCsfUploading(true);
    setPortalPreviewError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(
        `${CRM_API_BASE}/cliente/${portalPreview.cliente.id}/extraer-csf/`,
        {
          method: "POST",
          body: formData,
        }
      );
      const body = (await response.json().catch(() => ({}))) as PortalCsfUploadResponse;

      if (!response.ok || !body.success) {
        throw new Error(
          getErrorMessage(body, "No se pudo cargar la CSF del cliente.")
        );
      }

      if (body.portal) {
        setPortalPreview(body.portal);
      } else {
        await abrirPortalPreview(portalPreview.cliente.id);
      }
      showSuccess(body.mensaje || "CSF cargada y datos fiscales actualizados.");
      void fetchClientes();
    } catch (error) {
      setPortalPreviewError(
        error instanceof Error
          ? error.message
          : "No se pudo cargar la CSF del cliente."
      );
    } finally {
      setPortalCsfUploading(false);
      if (portalCsfInputRef.current) {
        portalCsfInputRef.current.value = "";
      }
    }
  };

  const copiarPortalValue = async (
    value: string | null | undefined,
    label: string
  ) => {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(`${label} copiado.`);
    } catch {
      alert("No se pudo copiar el dato. Seleccionalo manualmente.");
    }
  };

  const cerrarModalAsignacion = () => {
    if (assignmentModal.isSaving) {
      return;
    }
    setAssignmentModal({
      isOpen: false,
      intent: "manage",
      cliente: null,
      espacios: [],
      isLoading: false,
      isSaving: false,
      error: "",
      selectedEntityId: 0,
      selectedSpaceId: "",
      fechaInicio: todayLocalDate(),
      fechaFin: todayLocalDate(),
      observaciones: "",
    });
  };

  const abrirModalContrato = (cliente: ClienteListItem) => {
    setContractModal({
      isOpen: true,
      cliente,
      file: null,
      isUploading: false,
      error: "",
    });
    setContractInputKey((current) => current + 1);
  };

  const cerrarModalContrato = () => {
    if (contractModal.isUploading) {
      return;
    }
    setContractModal({
      isOpen: false,
      cliente: null,
      file: null,
      isUploading: false,
      error: "",
    });
    setContractInputKey((current) => current + 1);
  };

  const seleccionarArchivoContrato = (file: File | null) => {
    if (!file) {
      setContractModal((prev) => ({ ...prev, file: null, error: "" }));
      return;
    }
    const validationError = validateContractFile(file);
    setContractModal((prev) => ({
      ...prev,
      file: validationError ? null : file,
      error: validationError,
    }));
    if (validationError) {
      setContractInputKey((current) => current + 1);
    }
  };

  const subirContratoCliente = async () => {
    if (!contractModal.cliente) {
      return;
    }
    if (!contractModal.file) {
      setContractModal((prev) => ({
        ...prev,
        error: "Selecciona el archivo del contrato antes de continuar.",
      }));
      return;
    }

    setContractModal((prev) => ({ ...prev, isUploading: true, error: "" }));
    try {
      const formData = new FormData();
      formData.append("file", contractModal.file);
      const response = await fetch(
        `${CRM_API_BASE}/cliente/${contractModal.cliente.id}/contrato/`,
        {
          method: "POST",
          body: formData,
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
      };

      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo cargar el contrato digital.")
        );
      }

      await fetchClientes();
      showSuccess(body.mensaje || "Contrato digital cargado correctamente.");
      cerrarModalContrato();
    } catch (error) {
      setContractModal((prev) => ({
        ...prev,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo cargar el contrato digital.",
      }));
    } finally {
      setContractModal((prev) => ({ ...prev, isUploading: false }));
    }
  };

  const fetchEspaciosAsignacion = async (entidadId: number) => {
    const response = await fetch(
      `${ESPACIOS_API_BASE}/entidades/${entidadId}/lista/`,
      { cache: "no-store" }
    );
    const body = (await response.json().catch(() => ({}))) as
      | EspacioAsignacionOption[]
      | { detail?: string };

    if (!response.ok || !Array.isArray(body)) {
      throw new Error(
        getErrorMessage(body, "No se pudieron cargar los espacios de la entidad.")
      );
    }

    return body;
  };

  const abrirModalAsignacion = async (
    cliente: ClienteListItem,
    intent: AssignmentIntent = "manage"
  ) => {
    const today = todayLocalDate();
    setLoadingAssignmentClientId(cliente.id);
    setAssignmentModal({
      isOpen: true,
      intent,
      cliente,
      espacios: [],
      isLoading: true,
      isSaving: false,
      error: "",
      selectedEntityId: cliente.entidad_id,
      selectedSpaceId: "",
      fechaInicio: today,
      fechaFin: today,
      observaciones: "",
    });

    try {
      const body = await fetchEspaciosAsignacion(cliente.entidad_id);
      const currentAssignment = findActiveClientAssignment(body, cliente.id);
      setAssignmentModal((prev) => ({
        ...prev,
        espacios: body,
        isLoading: false,
        fechaFin: today,
        error:
          intent === "end" && !currentAssignment
            ? "Este cliente no tiene una asignacion activa para terminar. Puedes asignarle un espacio desde aqui."
            : "",
      }));
    } catch (error) {
      setAssignmentModal((prev) => ({
        ...prev,
        espacios: [],
        isLoading: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los espacios de la entidad.",
      }));
    } finally {
      setLoadingAssignmentClientId(null);
    }
  };

  const handleAssignmentEntityChange = async (entidadId: number) => {
    if (!entidadId) {
      setAssignmentModal((prev) => ({
        ...prev,
        selectedEntityId: 0,
        selectedSpaceId: "",
        espacios: [],
        error: "",
      }));
      return;
    }

    setAssignmentModal((prev) => ({
      ...prev,
      selectedEntityId: entidadId,
      selectedSpaceId: "",
      espacios: [],
      isLoading: true,
      error: "",
    }));

    try {
      const espacios = await fetchEspaciosAsignacion(entidadId);
      setAssignmentModal((prev) => ({
        ...prev,
        espacios,
        isLoading: false,
      }));
    } catch (error) {
      setAssignmentModal((prev) => ({
        ...prev,
        espacios: [],
        isLoading: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los espacios de la entidad.",
      }));
    }
  };

  const actualizarEntidadClienteParaAsignacion = async (
    clienteId: number,
    entidadId: number
  ) => {
    const detailResponse = await fetch(`${CRM_API_BASE}/cliente/${clienteId}/`, {
      cache: "no-store",
    });
    const detailBody = (await detailResponse.json().catch(() => ({}))) as
      | ClienteDetail
      | { detail?: string };

    if (!detailResponse.ok || !("id" in detailBody)) {
      throw new Error(
        getErrorMessage(
          detailBody,
          "No se pudo cargar la ficha del cliente para actualizar su unidad."
        )
      );
    }

    const updateResponse = await fetch(`${CRM_API_BASE}/cliente/${clienteId}/`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildClienteEntityUpdatePayload(detailBody, entidadId)),
    });
    const updateBody = (await updateResponse.json().catch(() => ({}))) as {
      detail?: string;
      mensaje?: string;
    };

    if (!updateResponse.ok) {
      throw new Error(
        getErrorMessage(updateBody, "No se pudo cambiar la unidad del cliente.")
      );
    }
  };

  const confirmarAsignacionCliente = async () => {
    const cliente = assignmentModal.cliente;
    if (!cliente) {
      return;
    }
    if (activeAssignment) {
      setAssignmentModal((prev) => ({
        ...prev,
        error:
          "Este cliente ya tiene una asignacion activa. Termina el contrato actual antes de asignar otro espacio.",
      }));
      return;
    }
    if (!assignmentModal.selectedEntityId) {
      setAssignmentModal((prev) => ({
        ...prev,
        error: "Selecciona la unidad de negocio antes de elegir el espacio.",
      }));
      return;
    }
    if (!assignmentModal.selectedSpaceId) {
      setAssignmentModal((prev) => ({
        ...prev,
        error: "Selecciona un espacio disponible para continuar.",
      }));
      return;
    }
    if (!isValidDateInput(assignmentModal.fechaInicio)) {
      setAssignmentModal((prev) => ({
        ...prev,
        error: "Selecciona una fecha de inicio valida.",
      }));
      return;
    }

    setAssignmentModal((prev) => ({ ...prev, isSaving: true, error: "" }));
    try {
      if (cliente.entidad_id !== assignmentModal.selectedEntityId) {
        await actualizarEntidadClienteParaAsignacion(
          cliente.id,
          assignmentModal.selectedEntityId
        );
      }

      const response = await fetch(
        `${ESPACIOS_API_BASE}/espacios/${assignmentModal.selectedSpaceId}/asignar/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cliente_id: cliente.id,
            fecha_inicio: assignmentModal.fechaInicio,
          }),
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
      };

      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo asignar el espacio."));
      }

      await fetchClientes();
      cerrarModalAsignacion();
      showSuccess(body.mensaje || "Espacio asignado correctamente.");
    } catch (error) {
      setAssignmentModal((prev) => ({
        ...prev,
        error:
          error instanceof Error ? error.message : "No se pudo asignar el espacio.",
      }));
    } finally {
      setAssignmentModal((prev) => ({ ...prev, isSaving: false }));
    }
  };

  const confirmarTerminoContrato = async () => {
    if (!activeAssignment?.asignacion_activa_id) {
      setAssignmentModal((prev) => ({
        ...prev,
        error: "No hay una asignacion activa para terminar.",
      }));
      return;
    }
    if (!isValidDateInput(assignmentModal.fechaFin)) {
      setAssignmentModal((prev) => ({
        ...prev,
        error: "Selecciona una fecha de termino valida.",
      }));
      return;
    }
    if (
      activeAssignment.ocupacion_desde &&
      assignmentModal.fechaFin < activeAssignment.ocupacion_desde
    ) {
      setAssignmentModal((prev) => ({
        ...prev,
        error: "La fecha de termino no puede ser anterior al inicio de estancia.",
      }));
      return;
    }

    setAssignmentModal((prev) => ({ ...prev, isSaving: true, error: "" }));
    try {
      const response = await fetch(
        `${ESPACIOS_API_BASE}/asignaciones/${activeAssignment.asignacion_activa_id}/finalizar/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fecha_fin: assignmentModal.fechaFin,
            observaciones: assignmentModal.observaciones.trim() || null,
          }),
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
      };

      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo terminar el contrato."));
      }

      await fetchClientes();
      cerrarModalAsignacion();
      showSuccess(body.mensaje || "Contrato terminado y espacio liberado.");
    } catch (error) {
      setAssignmentModal((prev) => ({
        ...prev,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo terminar el contrato.",
      }));
    } finally {
      setAssignmentModal((prev) => ({ ...prev, isSaving: false }));
    }
  };

  const iniciarBorrado = (ids: number[], nombres: string[]) => {
    if (ids.length === 0) {
      return;
    }
    setModalBorrado({
      isOpen: true,
      ids,
      nombres,
    });
  };

  const confirmarBorrado = async () => {
    if (modalBorrado.ids.length === 0) {
      return;
    }

    setIsDeleting(true);
    let eliminados = 0;
    let desactivados = 0;
    const errores: string[] = [];

    try {
      for (const clientId of modalBorrado.ids) {
        const response = await fetch(`${CRM_API_BASE}/cliente/${clientId}/`, {
          method: "DELETE",
        });
        const body = (await response.json().catch(() => ({}))) as {
          detail?: string;
          accion?: string;
        };

        if (!response.ok) {
          errores.push(
            getErrorMessage(body, `No se pudo procesar el cliente ${clientId}.`)
          );
          continue;
        }

        if (body.accion === "desactivado") {
          desactivados += 1;
        } else {
          eliminados += 1;
        }
      }

      await fetchClientes();
      setSelectedClients([]);

      if (eliminados || desactivados) {
        const parts = [];
        if (eliminados) {
          parts.push(`${eliminados} retirado(s) sin historial`);
        }
        if (desactivados) {
          parts.push(`${desactivados} desactivado(s)`);
        }
        showSuccess(`Proceso completado: ${parts.join(" y ")}.`);
      }

      if (errores.length > 0) {
        alert(errores.join("\n"));
      }
    } finally {
      setIsDeleting(false);
      setModalBorrado({ isOpen: false, ids: [], nombres: [] });
    }
  };

  const reactivarCliente = async (clienteId: number) => {
    setClientesError("");
    setReactivatingClientId(clienteId);

    try {
      const response = await fetch(
        `${CRM_API_BASE}/cliente/${clienteId}/reactivar/`,
        { method: "POST" }
      );
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
      };

      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo reactivar el cliente."));
      }

      setSelectedClients((current) => current.filter((id) => id !== clienteId));
      await fetchClientes();
      showSuccess(body.mensaje || "Cliente reactivado correctamente.");
    } catch (error) {
      setClientesError(
        error instanceof Error ? error.message : "No se pudo reactivar el cliente."
      );
    } finally {
      setReactivatingClientId(null);
    }
  };

  const handleDownloadTemplate = async () => {
    setIsDownloadingTemplate(true);
    setBatchError("");

    try {
      const response = await fetch(`${CRM_API_BASE}/batch/plantilla/`);
      if (!response.ok) {
        throw new Error("No se pudo descargar la plantilla de clientes.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = extractFilename(
        response.headers.get("content-disposition"),
        "plantilla-clientes.xlsx"
      );
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setBatchError(
        error instanceof Error
          ? error.message
          : "No se pudo descargar la plantilla."
      );
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const waitForBatchJob = async (jobId: number) => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const response = await fetch(buildApiUrl(`/billing/jobs/${jobId}/`), {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as
        | BackgroundJobStatus
        | { detail?: string };
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo consultar el estado de la importacion.")
        );
      }
      const job = body as BackgroundJobStatus;
      if (job.status === "SUCCESS" && job.result) {
        return job.result;
      }
      if (job.status === "ERROR" || job.status === "CANCELLED") {
        throw new Error(job.error || "La importacion termino con error.");
      }
      await sleep(2000);
    }
    throw new Error("La importacion sigue en proceso. Revisa salud operativa en unos minutos.");
  };

  const handleImportBatch = async () => {
    if (!batchFile) {
      setBatchError("Selecciona un archivo antes de importar.");
      return;
    }

    setIsBatchImporting(true);
    setBatchError("");
    setBatchResult(null);

    try {
      const formData = new FormData();
      formData.append("file", batchFile);

      const response = await fetch(`${CRM_API_BASE}/batch/importar/?async_job=true`, {
        method: "POST",
        body: formData,
      });

      const body = (await response.json().catch(() => ({}))) as
        | BatchImportResult
        | BatchImportAccepted
        | { detail?: string };
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo importar el archivo de clientes.")
        );
      }

      const result =
        "accepted" in body && body.accepted
          ? await waitForBatchJob(body.job_id)
          : (body as BatchImportResult);
      setBatchResult(result);
      setBatchFile(null);
      setBatchInputKey((current) => current + 1);
      await fetchClientes();
      showSuccess("Carga batch de clientes completada.");
    } catch (error) {
      setBatchError(
        error instanceof Error
          ? error.message
          : "No se pudo importar el archivo."
      );
    } finally {
      setIsBatchImporting(false);
    }
  };

  return (
    <div className="relative space-y-4">
      {mensajeExito && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border border-green-500/50 bg-green-500/20 px-4 py-2 text-green-400 shadow-lg">
          <span className="text-sm font-medium">{mensajeExito}</span>
        </div>
      )}

      {(portalPreview || portalPreviewError || isLoadingPortalId) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="flex flex-col gap-4 border-b border-zinc-800 p-5 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-300">
                  Vista del portal cliente
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">
                  {portalPreview?.cliente.nombre || "Cargando portal"}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">
                  {portalPreview?.cliente.entidad_nombre ||
                    "Estado de cuenta, pagos, datos fiscales y referencia de pago."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {portalPreview?.portal.url && (
                  <button
                    type="button"
                    onClick={() =>
                      void copiarPortalValue(portalPreview.portal.url, "Liga del portal")
                    }
                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-white"
                  >
                    Copiar liga
                  </button>
                )}
                {portalPreview?.portal.url && (
                  <a
                    href={portalPreview.portal.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-500/20"
                  >
                    Abrir portal
                  </a>
                )}
                <button
                  onClick={cerrarPortalPreview}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                >
                  Cerrar
                </button>
              </div>
            </div>

            <div className="max-h-[calc(92vh-112px)] overflow-y-auto p-5">
              {isLoadingPortalId ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-zinc-400">
                  Cargando vista del portal...
                </div>
              ) : portalPreviewError ? (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-200">
                  {portalPreviewError}
                </div>
              ) : portalPreview ? (
                <div className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                        Saldo vivo
                      </p>
                      <p className="mt-2 text-xl font-semibold text-white">
                        {formatCurrency(portalPreview.resumen.saldo_vivo)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                        Recargos
                      </p>
                      <p className="mt-2 text-xl font-semibold text-white">
                        {formatCurrency(portalPreview.resumen.recargos_activos)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                        Score
                      </p>
                      <p className="mt-2 text-xl font-semibold text-white">
                        {portalPreview.resumen.score_pago} |{" "}
                        {portalPreview.resumen.score_label}
                      </p>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                        Pagado
                      </p>
                      <p className="mt-2 text-xl font-semibold text-white">
                        {formatCurrency(portalPreview.resumen.total_pagado)}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
                    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-3">
                        <div>
                          <h4 className="font-semibold text-white">
                            Estado de cuenta
                          </h4>
                          <p className="text-sm text-zinc-500">
                            Cargos abiertos visibles para el cliente.
                          </p>
                        </div>
                        <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300">
                          {portalPreview.cuentas.length} registros
                        </span>
                      </div>
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full text-left text-sm text-zinc-300">
                          <thead className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                            <tr>
                              <th className="px-3 py-2">Concepto</th>
                              <th className="px-3 py-2">Vence</th>
                              <th className="px-3 py-2 text-right">Total</th>
                              <th className="px-3 py-2">Estatus</th>
                            </tr>
                          </thead>
                          <tbody>
                            {portalPreview.cuentas.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={4}
                                  className="px-3 py-8 text-center text-zinc-500"
                                >
                                  Sin cuentas abiertas para mostrar.
                                </td>
                              </tr>
                            ) : (
                              portalPreview.cuentas.slice(0, 8).map((cuenta) => (
                                <tr key={cuenta.id} className="border-t border-zinc-800">
                                  <td className="px-3 py-3">
                                    <div className="font-medium text-white">
                                      {cuenta.concepto}
                                    </div>
                                    <div className="text-xs text-zinc-500">
                                      {cuenta.espacio_codigo || "Sin espacio"}
                                    </div>
                                  </td>
                                  <td className="px-3 py-3">
                                    {formatDate(cuenta.fecha_vencimiento)}
                                  </td>
                                  <td className="px-3 py-3 text-right font-medium text-white">
                                    {formatCurrency(cuenta.total_a_pagar || 0)}
                                  </td>
                                  <td className="px-3 py-3">
                                    <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs">
                                      {portalStatusLabel(cuenta.categoria_tablero)}
                                    </span>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <div className="space-y-4">
                      <section className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                        <h4 className="font-semibold text-white">Referencia de pago</h4>
                        <div className="mt-3 space-y-2 text-sm text-zinc-200">
                          {([
                            ["Beneficiario", portalPreview.transferencia.beneficiario],
                            ["Banco", portalPreview.transferencia.banco],
                            ["CLABE", portalPreview.transferencia.clabe],
                            ["Referencia", portalPreview.transferencia.referencia],
                          ] as Array<[string, string | null | undefined]>).map(([label, value]) => (
                            <div
                              key={label}
                              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                            >
                              <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-100/70">
                                {label}
                              </p>
                              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <p className="break-all font-medium text-white">
                                  {value || "Pendiente"}
                                </p>
                                {value ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void copiarPortalValue(value, label)
                                    }
                                    className="shrink-0 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/20"
                                  >
                                    Copiar
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h4 className="font-semibold text-white">Datos fiscales</h4>
                            <p className="mt-1 text-sm text-zinc-500">
                              Carga la CSF para completar los datos de facturacion.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <input
                              ref={portalCsfInputRef}
                              type="file"
                              accept="application/pdf,.pdf"
                              className="hidden"
                              onChange={(event) =>
                                void cargarCsfPortal(event.target.files?.[0])
                              }
                            />
                            {portalPreview.datos_fiscales.archivo_csf_url ? (
                              <a
                                href={portalPreview.datos_fiscales.archivo_csf_url}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition-colors hover:bg-emerald-400/20"
                              >
                                Ver CSF
                              </a>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => portalCsfInputRef.current?.click()}
                              disabled={portalCsfUploading}
                              className="rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {portalCsfUploading ? "Cargando..." : "Cargar CSF"}
                            </button>
                          </div>
                        </div>
                        <div className="mt-3 space-y-2 text-sm text-zinc-300">
                          {([
                            ["Razon social", portalPreview.datos_fiscales.razon_social],
                            ["RFC", portalPreview.datos_fiscales.rfc],
                            ["Regimen", portalPreview.datos_fiscales.regimen_fiscal],
                            ["CP", portalPreview.datos_fiscales.codigo_postal],
                          ] as Array<[string, string | null | undefined]>).map(([label, value]) => (
                            <div
                              key={label}
                              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                            >
                              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                                {label}
                              </p>
                              <p className="mt-1 break-words font-medium text-white">
                                {value || "Pendiente"}
                              </p>
                            </div>
                          ))}
                          <div
                            className={`rounded-lg border px-3 py-2 text-xs ${
                              portalPreview.datos_fiscales.archivo_csf_url
                                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                                : "border-amber-400/20 bg-amber-400/10 text-amber-100"
                            }`}
                          >
                            {portalPreview.datos_fiscales.archivo_csf_url
                              ? "CSF disponible para timbrar facturas."
                              : "CSF pendiente. Al cargarla se actualizan RFC, regimen, CP y razon social."}
                          </div>
                        </div>
                      </section>

                      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                        <h4 className="font-semibold text-white">Cargar comprobante</h4>
                        <p className="mt-1 text-sm text-zinc-500">
                          El cliente selecciona una cuenta abierta y adjunta su archivo.
                        </p>
                        <div className="mt-3 grid gap-3 text-sm">
                          <label className="space-y-1">
                            <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                              Cuenta
                            </span>
                            <select
                              disabled
                              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-300"
                              value=""
                            >
                              <option>
                                {firstOpenPortalAccount(portalPreview.cuentas)
                                  ? `${firstOpenPortalAccount(portalPreview.cuentas)?.concepto} - ${formatCurrency(
                                      firstOpenPortalAccount(portalPreview.cuentas)?.total_a_pagar || 0,
                                    )}`
                                  : "Sin cuentas pendientes"}
                              </option>
                            </select>
                          </label>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="space-y-1">
                              <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                                Monto
                              </span>
                              <input
                                disabled
                                value={formatCurrency(
                                  firstOpenPortalAccount(portalPreview.cuentas)?.total_a_pagar || 0,
                                )}
                                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-300"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                                Referencia
                              </span>
                              <input
                                disabled
                                value={portalPreview.transferencia.referencia || "Pendiente"}
                                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-300"
                              />
                            </label>
                          </div>
                          <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-500">
                            PDF, PNG, JPG o WEBP hasta 10 MB
                          </div>
                        </div>
                      </section>
                    </div>
                  </div>

                  <section className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                      <h4 className="font-semibold text-white">Seguimiento</h4>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                            Puntualidad
                          </p>
                          <p className="mt-1 text-lg font-semibold text-white">
                            {formatPercent(portalPreview.resumen.puntualidad_porcentaje)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                            Morosidad
                          </p>
                          <p className="mt-1 text-lg font-semibold text-white">
                            {formatPercent(portalPreview.resumen.morosidad_porcentaje)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-zinc-300">
                        <div className="flex justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                          <span>Pagadas a tiempo</span>
                          <span className="font-medium text-white">
                            {portalPreview.comportamiento?.pagadas_a_tiempo || 0}
                          </span>
                        </div>
                        <div className="flex justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                          <span>En gracia</span>
                          <span className="font-medium text-white">
                            {portalPreview.comportamiento?.abiertas_en_gracia || 0}
                          </span>
                        </div>
                        <div className="flex justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                          <span>Vencidas abiertas</span>
                          <span className="font-medium text-white">
                            {portalPreview.comportamiento?.abiertas_vencidas || 0}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                      <h4 className="font-semibold text-white">Tendencia de cuenta</h4>
                      <div className="mt-3 space-y-3">
                        {(portalPreview.tendencia_periodos || []).length === 0 ? (
                          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
                            Sin periodos suficientes para mostrar tendencia.
                          </div>
                        ) : (
                          (portalPreview.tendencia_periodos || []).slice(-6).map((periodo) => {
                            const maxValue = Math.max(
                              periodo.facturado,
                              periodo.pagado,
                              periodo.pendiente,
                              1,
                            );
                            return (
                              <div key={periodo.label} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                                <div className="flex items-center justify-between gap-3 text-sm">
                                  <span className="font-medium text-white">{periodo.label}</span>
                                  <span className="text-zinc-400">
                                    Pendiente {formatCurrency(periodo.pendiente)}
                                  </span>
                                </div>
                                <div className="mt-3 grid gap-1.5">
                                  <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
                                    <div
                                      className="h-full rounded-full bg-cyan-400"
                                      style={{ width: `${Math.min((periodo.facturado / maxValue) * 100, 100)}%` }}
                                    />
                                  </div>
                                  <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
                                    <div
                                      className="h-full rounded-full bg-emerald-400"
                                      style={{ width: `${Math.min((periodo.pagado / maxValue) * 100, 100)}%` }}
                                    />
                                  </div>
                                  <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
                                    <div
                                      className="h-full rounded-full bg-amber-400"
                                      style={{ width: `${Math.min((periodo.pendiente / maxValue) * 100, 100)}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-white">Facturas recientes</h4>
                        <p className="text-sm text-zinc-500">
                          Descargas visibles para el cliente final.
                        </p>
                      </div>
                      <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300">
                        {portalPreview.facturas_recientes?.length || 0} documentos
                      </span>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {(portalPreview.facturas_recientes || []).length === 0 ? (
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
                          Aun no hay facturas disponibles para descargar.
                        </div>
                      ) : (
                        (portalPreview.facturas_recientes || []).slice(0, 6).map((factura) => {
                          const folio = [factura.serie, factura.folio].filter(Boolean).join("-");
                          const pdfDownloadUrl = buildPortalInvoiceDownloadUrl(
                            portalPreview.portal.url,
                            factura.id,
                            "pdf",
                          );
                          const xmlDownloadUrl = buildPortalInvoiceDownloadUrl(
                            portalPreview.portal.url,
                            factura.id,
                            "xml",
                          );
                          return (
                            <div
                              key={factura.id}
                              className="rounded-lg border border-zinc-800 bg-zinc-950 p-4"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium text-white">
                                    {folio || `Factura ${factura.id}`}
                                  </p>
                                  <p className="mt-1 text-xs text-zinc-500">
                                    {formatDate(factura.fecha_emision)} | {factura.estatus}
                                  </p>
                                  {factura.uuid ? (
                                    <p className="mt-1 max-w-xs truncate font-mono text-[11px] text-zinc-600">
                                      {factura.uuid}
                                    </p>
                                  ) : null}
                                </div>
                                <p className="font-semibold text-white">
                                  {formatCurrency(factura.total)}
                                </p>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {pdfDownloadUrl ? (
                                  <a
                                    href={pdfDownloadUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-100 transition-colors hover:bg-cyan-500/20"
                                  >
                                    PDF
                                  </a>
                                ) : null}
                                {xmlDownloadUrl ? (
                                  <a
                                    href={xmlDownloadUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                                  >
                                    XML
                                  </a>
                                ) : null}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </section>

                  <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                    <h4 className="font-semibold text-white">Pagos recientes</h4>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {portalPreview.pagos_recientes.length === 0 ? (
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
                          Aun no hay pagos recientes registrados.
                        </div>
                      ) : (
                        portalPreview.pagos_recientes.slice(0, 4).map((pago) => (
                          <div
                            key={pago.id}
                            className="rounded-lg border border-zinc-800 bg-zinc-950 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium text-white">{pago.concepto}</p>
                                <p className="mt-1 text-xs text-zinc-500">
                                  {formatDate(pago.fecha_pago)} |{" "}
                                  {pago.metodo || "Pago"}
                                </p>
                              </div>
                              <p className="font-semibold text-emerald-300">
                                {formatCurrency(pago.monto)}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {contractModal.isOpen && contractModal.cliente ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="flex flex-col gap-4 border-b border-zinc-800 p-6 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
                  CRM | Contrato digital
                </p>
                <h3 className="text-2xl font-bold text-white">
                  {contractModal.cliente.contrato_digital_cargado
                    ? "Consultar contrato"
                    : "Subir contrato"}
                </h3>
                <p className="mt-2 max-w-xl text-sm text-zinc-400">
                  Guarda el contrato firmado del cliente para tener el expediente
                  operativo completo sin entrar a editar toda su ficha.
                </p>
              </div>
              <button
                type="button"
                onClick={cerrarModalContrato}
                disabled={contractModal.isUploading}
                className="self-start rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                Cerrar
              </button>
            </div>

            <div className="space-y-5 p-6">
              {contractModal.error ? (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {contractModal.error}
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                    Cliente
                  </p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {getClienteDisplayName(contractModal.cliente)}
                  </p>
                  <p className="mt-1 text-sm text-zinc-400">
                    {contractModal.cliente.entidad || "Sin entidad"}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                    Estado
                  </p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {contractModal.cliente.contrato_digital_cargado
                      ? "Contrato cargado"
                      : "Sin contrato digital"}
                  </p>
                  <p className="mt-1 truncate text-sm text-zinc-400">
                    {contractModal.cliente.contrato_digital_nombre ||
                      "Pendiente de archivo firmado"}
                  </p>
                </div>
              </div>

              {contractModal.cliente.contrato_digital_url ? (
                <div className="flex flex-col gap-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Documento disponible
                    </p>
                    <p className="mt-1 text-sm text-zinc-400">
                      Puedes consultarlo en una nueva pestaña o cargar una version
                      actualizada si el contrato cambio.
                    </p>
                  </div>
                  <a
                    href={contractModal.cliente.contrato_digital_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/20"
                  >
                    Abrir contrato
                  </a>
                </div>
              ) : null}

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                  Archivo de contrato
                </span>
                <input
                  key={contractInputKey}
                  type="file"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  disabled={contractModal.isUploading}
                  onChange={(event) =>
                    seleccionarArchivoContrato(event.target.files?.[0] || null)
                  }
                  className="mt-2 w-full rounded-xl border border-dashed border-zinc-700 bg-zinc-900/60 px-4 py-4 text-sm text-zinc-300 file:mr-4 file:rounded-lg file:border-0 file:bg-cyan-500/15 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-cyan-100 hover:border-cyan-500/40 disabled:opacity-60"
                />
                <span className="mt-2 block text-xs text-zinc-500">
                  Formatos permitidos: PDF, Word o imagen. Tamano maximo 15 MB.
                </span>
              </label>

              <div className="flex flex-col gap-3 border-t border-zinc-800 pt-5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={cerrarModalContrato}
                  disabled={contractModal.isUploading}
                  className="rounded-xl px-5 py-3 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void subirContratoCliente()}
                  disabled={contractModal.isUploading || !contractModal.file}
                  className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
                >
                  {contractModal.isUploading
                    ? "Subiendo..."
                    : contractModal.cliente.contrato_digital_cargado
                      ? "Reemplazar contrato"
                      : "Subir contrato"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {assignmentModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="flex flex-col gap-4 border-b border-zinc-800 p-6 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
                  CRM | Asignacion
                </p>
                <h3 className="text-2xl font-bold text-white">
                  Gestionar espacio del cliente
                </h3>
                <p className="mt-2 max-w-2xl text-sm text-zinc-400">
                  Asigna el espacio con la fecha real de inicio o termina el
                  contrato activo sin editar toda la ficha fiscal del cliente.
                </p>
              </div>
              <button
                type="button"
                onClick={cerrarModalAsignacion}
                disabled={assignmentModal.isSaving}
                className="self-start rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                Cerrar
              </button>
            </div>

            <div className="space-y-5 p-6">
              {assignmentModal.error ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  {assignmentModal.error}
                </div>
              ) : null}

              {assignmentModal.isLoading ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-zinc-400">
                  Cargando espacios y asignaciones de la entidad...
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                        Cliente
                      </p>
                      <p className="mt-2 text-lg font-semibold text-white">
                        {assignmentModal.cliente
                          ? getClienteDisplayName(assignmentModal.cliente)
                          : "Cliente"}
                      </p>
                      <p className="mt-1 text-sm text-zinc-400">
                        {assignmentModal.cliente?.entidad || "Sin entidad"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                        Estado de ocupacion
                      </p>
                      <p className="mt-2 text-lg font-semibold text-white">
                        {activeAssignment ? "Contrato activo" : "Sin espacio activo"}
                      </p>
                      <p className="mt-1 text-sm text-zinc-400">
                        {activeAssignment
                          ? `${activeAssignment.codigo} desde ${formatDate(
                              activeAssignment.ocupacion_desde
                            )}`
                          : "Puedes asignar un espacio disponible de esta entidad."}
                      </p>
                    </div>
                  </div>

                  {activeAssignment ? (
                    <section className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-200">
                            Termino de contrato
                          </p>
                          <h4 className="mt-2 text-xl font-bold text-white">
                            Liberar {activeAssignment.codigo}
                          </h4>
                          <p className="mt-2 text-sm text-zinc-400">
                            Al terminar el contrato, el espacio vuelve a quedar
                            disponible y las cuentas futuras de esta asignacion se
                            cancelan segun la fecha de termino.
                          </p>
                        </div>
                        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
                          {activeAssignment.tipo_nombre || "Espacio"}
                        </span>
                      </div>

                      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                            Fecha de termino
                          </span>
                          <input
                            type="date"
                            value={assignmentModal.fechaFin}
                            onChange={(event) =>
                              setAssignmentModal((prev) => ({
                                ...prev,
                                fechaFin: event.target.value,
                                error: "",
                              }))
                            }
                            className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-white outline-none transition focus:border-red-400 focus:ring-1 focus:ring-red-400"
                          />
                          <span className="mt-1 block text-xs text-zinc-500">
                            Puede ser hoy, una fecha anterior o una fecha posterior
                            al cierre operativo real.
                          </span>
                        </label>
                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                            Observaciones
                          </span>
                          <textarea
                            value={assignmentModal.observaciones}
                            maxLength={250}
                            rows={3}
                            onChange={(event) =>
                              setAssignmentModal((prev) => ({
                                ...prev,
                                observaciones: event.target.value.slice(0, 250),
                                error: "",
                              }))
                            }
                            placeholder="Ej. termino anticipado, cambio de espacio o cierre normal."
                            className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-white outline-none transition focus:border-red-400 focus:ring-1 focus:ring-red-400"
                          />
                        </label>
                      </div>

                      <div className="mt-5 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void confirmarTerminoContrato()}
                          disabled={assignmentModal.isSaving}
                          className="rounded-xl border border-red-500/30 bg-red-500/15 px-5 py-3 text-sm font-semibold text-red-100 transition-colors hover:bg-red-500/25 disabled:opacity-50"
                        >
                          {assignmentModal.isSaving
                            ? "Terminando..."
                            : "Terminar contrato"}
                        </button>
                      </div>
                    </section>
                  ) : (
                    <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
                        Nueva asignacion
                      </p>
                      <h4 className="mt-2 text-xl font-bold text-white">
                        Asignar espacio disponible
                      </h4>
                      <p className="mt-2 text-sm text-zinc-400">
                        Primero elige la unidad de negocio, despues el espacio y la
                        fecha real de inicio. Por default se propone el dia actual.
                      </p>

                      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                            Unidad de negocio
                          </span>
                          <select
                            value={assignmentModal.selectedEntityId}
                            onChange={(event) =>
                              void handleAssignmentEntityChange(
                                Number(event.target.value)
                              )
                            }
                            disabled={assignmentModal.isSaving}
                            className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 disabled:opacity-60"
                          >
                            <option value={0}>Selecciona unidad</option>
                            {entidadesDisponibles.map((entity) => (
                              <option key={entity.id} value={entity.id}>
                                {entity.nombre}
                              </option>
                            ))}
                          </select>
                          <span className="mt-1 block text-xs text-zinc-500">
                            Si eliges otra unidad, el cliente quedara vinculado a
                            esa unidad al asignar.
                          </span>
                        </label>
                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                            Espacio
                          </span>
                          <select
                            value={assignmentModal.selectedSpaceId}
                            onChange={(event) =>
                              setAssignmentModal((prev) => ({
                                ...prev,
                                selectedSpaceId: event.target.value,
                                error: "",
                              }))
                            }
                            disabled={
                              !assignmentModal.selectedEntityId ||
                              availableAssignmentSpaces.length === 0
                            }
                            className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 disabled:opacity-60"
                          >
                            <option value="">
                              {!assignmentModal.selectedEntityId
                                ? "Selecciona unidad primero"
                                : availableAssignmentSpaces.length === 0
                                  ? "Sin espacios disponibles"
                                  : "Selecciona un espacio"}
                            </option>
                            {availableAssignmentSpaces.map((space) => (
                              <option key={space.id} value={space.id}>
                                {space.codigo}
                                {space.tipo_nombre ? ` | ${space.tipo_nombre}` : ""}
                                {space.renta_sugerida
                                  ? ` | ${formatCurrency(
                                      Number(space.renta_sugerida)
                                    )}`
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                            Fecha de inicio
                          </span>
                          <input
                            type="date"
                            value={assignmentModal.fechaInicio}
                            onChange={(event) =>
                              setAssignmentModal((prev) => ({
                                ...prev,
                                fechaInicio: event.target.value,
                                error: "",
                              }))
                            }
                            className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
                          />
                          <span className="mt-1 block text-xs text-zinc-500">
                            Puedes registrar una estancia que inicia hoy, despues o
                            incluso una fecha anterior.
                          </span>
                        </label>
                      </div>

                      {assignmentModal.cliente &&
                      assignmentModal.selectedEntityId !==
                        assignmentModal.cliente.entidad_id ? (
                        <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                          Al confirmar, el cliente tambien cambiara de unidad de
                          negocio para que la asignacion quede consistente.
                        </div>
                      ) : null}

                      <div className="mt-5 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void confirmarAsignacionCliente()}
                          disabled={
                            assignmentModal.isSaving ||
                            !assignmentModal.selectedEntityId ||
                            !assignmentModal.selectedSpaceId ||
                            availableAssignmentSpaces.length === 0
                          }
                          className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
                        >
                          {assignmentModal.isSaving
                            ? "Asignando..."
                            : "Asignar espacio"}
                        </button>
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {modalBorrado.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <h3 className="mb-2 text-xl font-bold text-white">
              Desactivar cliente
            </h3>
            <p className="mb-3 text-sm text-zinc-400">
              {modalBorrado.ids.length === 1 ? (
                <>
                  Se procesara{" "}
                  <span className="font-semibold text-white">
                    {modalBorrado.nombres[0]}
                  </span>
                  . Si tiene historial operativo o financiero, se desactivara y
                  dejara de aparecer en la lista normal.
                </>
              ) : (
                <>
                  Se procesaran{" "}
                  <span className="font-semibold text-white">
                    {modalBorrado.ids.length} clientes
                  </span>
                  . Los que tengan historial quedaran desactivados y solo se veran
                  en el filtro Inactivos.
                </>
              )}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() =>
                  setModalBorrado({ isOpen: false, ids: [], nombres: [] })
                }
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                Cancelar
              </button>
              <button
                onClick={() => void confirmarBorrado()}
                disabled={isDeleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
              >
                {isDeleting ? "Procesando..." : "Confirmar desactivacion"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isBatchImporting ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-cyan-500/20 bg-zinc-950 p-6 text-center shadow-2xl shadow-cyan-950/40">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-cyan-400/20 border-t-cyan-300" />
            <p className="mt-4 text-lg font-semibold text-white">
              Procesando carga batch
            </p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Estamos validando la cartera de clientes y guardando los registros
              correctos. Mantente en esta pantalla hasta que el servidor responda.
            </p>
          </div>
        </div>
      ) : null}

      {clientesError ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {clientesError}
        </div>
      ) : null}

      <input
        key={batchInputKey}
        ref={batchInputRef}
        type="file"
        accept=".xlsx,.xlsm,.csv"
        className="hidden"
        disabled={isBatchImporting}
        onChange={(event) => {
          const file = event.target.files?.[0] || null;
          setBatchFile(file);
          setBatchError("");
        }}
      />

      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/70">
        <button
          type="button"
          onClick={() => setMostrarBatch((current) => !current)}
          className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-zinc-900/40"
        >
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">
              Actualizacion batch
            </p>
            <h2 className="mt-1.5 text-lg font-semibold text-white">
              Descarga tu cartera actual, edita y vuelve a importar
            </h2>
            {!mostrarBatch ? (
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-zinc-300">
                  Total registrados: {totalClientes}
                </span>
                {batchFile ? (
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
                    Archivo listo: {batchFile.name}
                  </span>
                ) : null}
                {batchResult ? (
                  <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-cyan-200">
                    Ultima carga: {batchResult.total_filas} filas procesadas
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-300 sm:inline-flex">
              {mostrarBatch ? "Ocultar" : "Mostrar"}
            </span>
            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-300 transition-transform ${
                mostrarBatch ? "rotate-180" : ""
              }`}
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
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </span>
          </div>
        </button>

        {mostrarBatch ? (
          <div className="border-t border-zinc-800 px-4 py-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-2xl">
                <p className="text-sm leading-relaxed text-zinc-500">
                  La plantilla sale con los clientes actuales y su ID interno para
                  actualizar sin duplicar. Puedes completar RFC, contacto, datos
                  fiscales y entidad; si agregas filas nuevas, tambien se crean
                  clientes desde el mismo archivo.
                </p>

                <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-3">
                  <div className="page-section-tight">
                    <p className="text-sm font-medium text-white">1. Descarga</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Baja la cartera actual con IDs internos.
                    </p>
                  </div>
                  <div className="page-section-tight">
                    <p className="text-sm font-medium text-white">2. Actualiza</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Edita contacto, RFC, entidad y datos fiscales.
                    </p>
                  </div>
                  <div className="page-section-tight">
                    <p className="text-sm font-medium text-white">3. Importa</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      El sistema actualiza existentes y crea filas nuevas.
                    </p>
                  </div>
                </div>
              </div>

              <div className="page-section-tight w-full max-w-xl">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <button
                    onClick={() => void handleDownloadTemplate()}
                    disabled={isDownloadingTemplate || isBatchImporting}
                    className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isDownloadingTemplate ? "Descargando..." : "Descargar plantilla"}
                  </button>
                  <button
                    onClick={() => void handleImportBatch()}
                    disabled={!batchFile || isBatchImporting}
                    className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBatchImporting ? "Importando..." : "Importar archivo"}
                  </button>
                </div>

                <div className="mt-3">
                  <label className="mb-1 block text-sm font-medium text-zinc-300">
                    Archivo batch
                  </label>
                  <button
                    type="button"
                    onClick={() => batchInputRef.current?.click()}
                    disabled={isBatchImporting}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-left text-sm text-zinc-300 transition-colors hover:border-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="rounded-md bg-zinc-800 px-3 py-2 text-sm font-medium text-white">
                      Examinar...
                    </span>
                    <span className="min-w-0 flex-1 truncate text-zinc-400">
                      {batchFile?.name || "Ningun archivo seleccionado."}
                    </span>
                  </button>
                  <p className="mt-2 text-xs text-zinc-500">
                    Compatible con archivos .xlsx, .xlsm y .csv.
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Carga recomendada por pagina:{" "}
                    <span className="font-semibold text-white">20 registros</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {batchFile && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  Archivo listo: {batchFile.name}
                </div>
              )}

            {batchError && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {batchError}
              </div>
            )}

            {batchResult && (
              <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-3">
                <p className="text-sm font-semibold text-cyan-200">
                  {batchResult.mensaje}
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-4">
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/60">
                    <p className="metric-label-compact">Filas procesadas</p>
                    <p className="mt-1.5 text-base font-bold text-white">
                      {batchResult.total_filas}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/60">
                    <p className="metric-label-compact">Clientes creados</p>
                    <p className="mt-1.5 text-base font-bold text-emerald-300">
                      {batchResult.clientes_creados}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/60">
                    <p className="metric-label-compact">Clientes actualizados</p>
                    <p className="mt-1.5 text-base font-bold text-cyan-300">
                      {batchResult.clientes_actualizados}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/60">
                    <p className="metric-label-compact">Filas omitidas</p>
                    <p className="mt-1.5 text-base font-bold text-amber-300">
                      {batchResult.filas_omitidas}
                    </p>
                  </div>
                </div>
                {batchResult.errores.length > 0 && (
                  <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
                    <p className="font-semibold">Observaciones de importacion</p>
                    <ul className="mt-2 space-y-1 text-xs text-amber-100">
                      {batchResult.errores.slice(0, 5).map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-t-xl border border-zinc-800 border-b-0 bg-zinc-950/70 p-3.5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative w-full xl:max-w-sm">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-500">
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </span>
              <input
                type="text"
                placeholder="Buscar cliente, RFC, telefono o identificador..."
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-9 pr-4 text-sm text-white outline-none transition-all focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value);
                  setPaginaActual(1);
                }}
              />
            </div>

            <select
              className="rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-3 pr-8 text-sm text-zinc-300 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              value={filtroEntidadId}
              onChange={(event) => {
                setFiltroEntidadId(event.target.value);
                setPaginaActual(1);
              }}
            >
              <option value="Todas">Todas las entidades</option>
              {entidadesDisponibles.map((entidad) => (
                <option key={entidad.id} value={entidad.id}>
                  {entidad.nombre}
                </option>
              ))}
            </select>

            <select
              className="rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-3 pr-8 text-sm text-zinc-300 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              value={filtroContrato}
              onChange={(event) => {
                setFiltroContrato(event.target.value);
                setPaginaActual(1);
              }}
            >
              <option value="Activo">Contrato activo</option>
              <option value="Todos">Todos los contratos</option>
              <option value="Baja">Sin contrato / baja</option>
            </select>

            <select
              className="rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-3 pr-8 text-sm text-zinc-300 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              value={filtroDatos}
              onChange={(event) => {
                setFiltroDatos(event.target.value);
                setPaginaActual(1);
              }}
            >
              <option value="Todos">Todos los datos</option>
              <option value="Incompletos">Datos incompletos</option>
            </select>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={abrirModalNuevo}
              className="whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition-colors hover:bg-blue-500"
            >
              Agregar cliente
            </button>

          {selectedClients.length > 0 ? (
            <button
              onClick={() => iniciarBorrado(selectedClients, selectedClientNames)}
              className="flex items-center rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300"
            >
              <svg
                className="mr-2 h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              Desactivar ({selectedClients.length})
            </button>
          ) : null}
          </div>
        </div>
      </div>

      <div className="mt-0 overflow-hidden rounded-b-xl border border-zinc-800 bg-zinc-950 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-300">
            <thead className="border-b border-zinc-800 bg-zinc-900 text-xs font-semibold uppercase text-zinc-400">
              <tr>
                <th className="w-12 px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    className="cursor-pointer rounded border-zinc-700 bg-zinc-800 text-blue-500 focus:ring-blue-500/50"
                    checked={
                      clientes.length > 0 &&
                      selectedClients.length === clientes.length
                    }
                    onChange={(event) => handleSelectAll(event.target.checked)}
                  />
                </th>
                <th className="px-6 py-3">Identificador</th>
                <th className="px-6 py-3">Cliente</th>
                <th className="px-6 py-3">Entidad</th>
                <th className="px-6 py-3">RFC</th>
                <th className="px-6 py-3">Contacto</th>
                <th className="px-6 py-3 text-right">Saldo</th>
                <th className="px-6 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {clientes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-zinc-500">
                    {isLoadingClientes
                      ? "Cargando clientes..."
                      : "No se encontraron clientes con estos filtros."}
                  </td>
                </tr>
              ) : (
                clientes.map((cliente) => {
                  const isReactivating = reactivatingClientId === cliente.id;
                  const isAssignmentLoading =
                    loadingAssignmentClientId === cliente.id;
                  const isActionLoading =
                    isLoadingDetailId === cliente.id ||
                    isLoadingPortalId === cliente.id ||
                    isReactivating ||
                    isAssignmentLoading;
                  const displayName = getClienteDisplayName(cliente);
                  return (
                    <tr
                      key={cliente.id}
                      className={`transition-colors hover:bg-zinc-900/50 ${
                        selectedClients.includes(cliente.id)
                          ? "bg-blue-500/5"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          className="cursor-pointer rounded border-zinc-700 bg-zinc-800 text-blue-500 focus:ring-blue-500/50"
                          checked={selectedClients.includes(cliente.id)}
                          onChange={() => handleSelectOne(cliente.id)}
                        />
                      </td>
                      <td className="px-6 py-3 text-zinc-400">
                        {cliente.identificador || "---"}
                      </td>
                      <td className="px-6 py-3">
                        <div className="font-medium text-white">{displayName}</div>
                        {!cliente.datosFiscalesCompletos && (
                          <div className="mt-1 flex items-center text-xs text-amber-400">
                            <svg
                              className="mr-1 h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                              />
                            </svg>
                            Completar datos para facturar
                          </div>
                        )}
                        {cliente.tiene_asignacion_activa &&
                        !cliente.contrato_digital_cargado ? (
                          <div className="mt-1 flex items-center text-xs text-cyan-300">
                            <svg
                              className="mr-1 h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M8.25 7.5h7.5M8.25 12h7.5M8.25 16.5h4.5M4.5 5.25A2.25 2.25 0 016.75 3h10.5a2.25 2.25 0 012.25 2.25v13.5A2.25 2.25 0 0117.25 21H6.75a2.25 2.25 0 01-2.25-2.25V5.25z"
                              />
                            </svg>
                            Contrato digital pendiente
                          </div>
                        ) : null}
                        {cliente.no_contactar_cobranza ? (
                          <div className="mt-1 flex items-center text-xs text-amber-300">
                            <svg
                              className="mr-1 h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M18.364 18.364A9 9 0 115.636 5.636m12.728 12.728L5.636 5.636"
                              />
                            </svg>
                            No contactar cobranza
                          </div>
                        ) : null}
                      </td>
                      <td className="px-6 py-3 text-zinc-300">{cliente.entidad}</td>
                      <td className="px-6 py-3 font-mono text-xs">
                        {cliente.rfc || "---"}
                      </td>
                      <td className="px-6 py-3">
                        <p className="text-sm text-zinc-200">
                          {cliente.telefono || "Sin telefono"}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {cliente.correo_principal || "Sin correo"}
                        </p>
                      </td>
                      <td className="px-6 py-3 text-right font-medium">
                        {formatCurrency(cliente.saldo)}
                      </td>
                      <td className="px-6 py-3 text-center">
                        <div className="flex items-center justify-center space-x-3">
                          <button
                            disabled={isActionLoading}
                            onClick={() => void abrirPortalPreview(cliente.id)}
                            className="text-zinc-500 transition-colors hover:text-cyan-300 disabled:opacity-50"
                            title="Vista del portal"
                          >
                            <svg
                              className="h-4 w-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12 18 18.75 12 18.75 2.25 12 2.25 12z"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                            </svg>
                          </button>
                          <button
                            disabled={isActionLoading}
                            onClick={() => void abrirModalAsignacion(cliente)}
                            className="text-zinc-500 transition-colors hover:text-cyan-300 disabled:opacity-50"
                            title="Gestionar asignacion"
                          >
                            <svg
                              className="h-4 w-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M8.25 7.5h7.5M8.25 12h7.5M8.25 16.5h4.5M4.5 5.25A2.25 2.25 0 016.75 3h10.5a2.25 2.25 0 012.25 2.25v13.5A2.25 2.25 0 0117.25 21H6.75a2.25 2.25 0 01-2.25-2.25V5.25z"
                              />
                            </svg>
                          </button>
                          <button
                            disabled={isActionLoading}
                            onClick={() => abrirModalContrato(cliente)}
                            className={`transition-colors disabled:opacity-50 ${
                              cliente.contrato_digital_cargado
                                ? "text-cyan-400 hover:text-cyan-200"
                                : "text-zinc-500 hover:text-amber-300"
                            }`}
                            title={
                              cliente.contrato_digital_cargado
                                ? "Consultar contrato digital"
                                : "Subir contrato digital"
                            }
                          >
                            <svg
                              className="h-4 w-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5A3.375 3.375 0 0010.125 2.25H6.75A2.25 2.25 0 004.5 4.5v15a2.25 2.25 0 002.25 2.25h10.5a2.25 2.25 0 002.25-2.25v-2.25"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d={
                                  cliente.contrato_digital_cargado
                                    ? "M12 18.75s2.25-3 5.25-3 5.25 3 5.25 3-2.25 3-5.25 3-5.25-3-5.25-3zM17.25 18.75h.008v.008h-.008v-.008z"
                                    : "M12 15l3-3m0 0l3 3m-3-3v9"
                                }
                              />
                            </svg>
                          </button>
                          <button
                            disabled={isActionLoading}
                            onClick={() =>
                              void abrirModalConCliente(cliente.id, "edit")
                            }
                            className="text-zinc-500 transition-colors hover:text-blue-400 disabled:opacity-50"
                            title="Editar"
                          >
                            <svg
                              className="h-4 w-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                              />
                            </svg>
                          </button>
                          <button
                            disabled={isActionLoading}
                            onClick={() =>
                              void abrirModalConCliente(cliente.id, "clone")
                            }
                            className="text-zinc-500 transition-colors hover:text-green-400 disabled:opacity-50"
                            title="Copiar"
                          >
                            <svg
                              className="h-4 w-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                              />
                            </svg>
                          </button>
                          {cliente.activo && cliente.tiene_asignacion_activa ? (
                            <button
                              disabled={isActionLoading}
                              onClick={() =>
                                void abrirModalAsignacion(cliente, "end")
                              }
                              className="text-zinc-500 transition-colors hover:text-red-300 disabled:opacity-50"
                              title="Terminar contrato"
                            >
                              <svg
                                className="h-4 w-4"
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
                          ) : !cliente.activo ? (
                            <button
                              disabled={isActionLoading}
                              onClick={() => void reactivarCliente(cliente.id)}
                              className="text-zinc-500 transition-colors hover:text-emerald-400 disabled:opacity-50"
                              title="Reactivar"
                            >
                              <svg
                                className="h-4 w-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M3 12a9 9 0 101.64-5.2M3 4v5h5m6 2l2 2 4-4"
                                />
                              </svg>
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400 md:flex-row md:items-center md:justify-between">
          <div>
            Mostrando {indiceInicial}-{indiceFinal} de {totalClientes} registros
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <span>Por pagina</span>
              <select
                value={itemsPorPagina}
                onChange={(event) => {
                  setItemsPorPagina(Number(event.target.value));
                  setPaginaActual(1);
                }}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPaginaActual((current) => Math.max(current - 1, 1))}
                disabled={currentPage <= 1}
                className="rounded border border-zinc-700 px-3 py-1.5 transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                Anterior
              </button>
              <span className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white">
                {currentPage}
              </span>
              <span>de {totalPaginas}</span>
              <button
                onClick={() =>
                  setPaginaActual((current) => Math.min(current + 1, totalPaginas))
                }
                disabled={currentPage >= totalPaginas}
                className="rounded border border-zinc-700 px-3 py-1.5 transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>
      </div>

      <ClienteFormModal
        isOpen={isModalOpen}
        mode={modalMode}
        cliente={clienteModalData}
        entityOptions={entidadesDisponibles}
        onClose={() => {
          setIsModalOpen(false);
          setClienteModalData(null);
        }}
        onSuccess={(message) => {
          setIsModalOpen(false);
          setClienteModalData(null);
          void fetchClientes();
          showSuccess(message || "Cliente guardado correctamente.");
        }}
      />
    </div>
  );
}
