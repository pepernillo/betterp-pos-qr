"use client";

import Link from "next/link";

import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

import { buildApiUrl } from "@/lib/api";
import {
  getOperationalFiscalRegimeOptions,
  normalizeOperationalFiscalRegimeValue,
} from "@/lib/fiscalRegimes";

type OnboardingStatus = "COMPLETO" | "EN_PROCESO" | "PENDIENTE";

interface OnboardingMetric {
  label: string;
  value: string;
}

interface OnboardingStep {
  id: string;
  titulo: string;
  descripcion: string;
  por_que_importa: string;
  progreso: number;
  estado: OnboardingStatus;
  accion_label: string;
  accion_href: string;
  bloqueos: string[];
  metricas: OnboardingMetric[];
}

interface OnboardingProfile {
  tipo_capa: string;
  titulo: string;
  descripcion: string;
  prioridades: string[];
  modulos_clave: string[];
}

interface SuggestedRule {
  nombre: string;
  descripcion: string;
  tipo_calculo: string;
  tipo_calculo_label?: string;
  valor: number;
  periodicidad: string;
  periodicidad_label?: string;
  aplica_a_todos: boolean;
  dias_condicion: number | null;
  ya_existe: boolean;
}

interface BusinessRule {
  id: number;
  nombre: string;
  tipo_calculo: string;
  tipo_calculo_label?: string;
  valor: number;
  periodicidad: string;
  periodicidad_label?: string;
  aplica_a_todos: boolean;
  dias_condicion: number | null;
  activo: boolean;
}

interface RuleCatalogs {
  tipos_calculo: Array<{ value: string; label: string }>;
  periodicidades: Array<{ value: string; label: string }>;
}

interface OnboardingEntityOption {
  id: number;
  nombre: string;
  ciudad?: string | null;
}

interface OnboardingCxpProgram {
  id: number;
  entidad_id: number;
  entidad_nombre: string;
  nombre: string;
  categoria: string;
  naturaleza: string;
  proveedor_nombre: string;
  banco_pago: string;
  cuenta_pago: string;
  clabe_pago: string;
  prioridad: string;
  fecha_inicio: string;
  fecha_fin: string;
  monto_base: number;
  periodicidad: string;
  dia_vencimiento?: number | null;
  dias_gracia: number;
  genera_recargo: boolean;
  prorrateable: boolean;
  activo: boolean;
  observaciones: string;
}

interface CapaConfig {
  id: number;
  nombre: string;
  tipo_capa: string;
  nombre_administrador: string | null;
  es_persona_moral: boolean;
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
  fecha_vencimiento_modo: string;
  dia_vencimiento_default: number | null;
  dias_gracia_default: number;
  auto_renueva_default: boolean;
  aplicacion_pagos: string;
  activo: boolean;
}

interface CapaFormState {
  nombre: string;
  tipo_capa: string;
  nombre_administrador: string;
  es_persona_moral: boolean;
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
  fecha_vencimiento_modo: string;
  dia_vencimiento_default: string;
  dias_gracia_default: string;
  auto_renueva_default: boolean;
  aplicacion_pagos: string;
  activo: boolean;
}

type GlobalDueMode = "global" | "individual";
type RulesOnboardingTab = "cobro" | "reglas";
type CxpOnboardingTab = "manual" | "batch";

interface FieldInfo {
  title: string;
  body: string;
  details?: string[];
}

interface RuleFormState {
  id: number | null;
  nombre: string;
  tipo_calculo: string;
  valor: string;
  periodicidad: string;
  aplica_a_todos: boolean;
  dias_condicion: string;
  activo: boolean;
}

interface RuleSaveResult {
  ok: boolean;
  error?: string;
}

interface CxpProgramSaveResult {
  ok: boolean;
  error?: string;
}

interface BatchErrorReport {
  filename: string;
  contentBase64: string;
  rows: number;
}

interface CxpProgramFormState {
  id: number | null;
  entidad_id: string;
  nombre: string;
  categoria: string;
  naturaleza: string;
  proveedor_nombre: string;
  banco_pago: string;
  cuenta_pago: string;
  clabe_pago: string;
  prioridad: string;
  periodicidad: string;
  fecha_inicio: string;
  fecha_fin: string;
  dia_vencimiento: string;
  monto_base: string;
  dias_gracia: string;
  genera_recargo: boolean;
  prorrateable: boolean;
  activo: boolean;
  observaciones: string;
}

interface OnboardingPayload {
  capa: {
    id: number;
    nombre: string;
    tipo_capa: string;
  };
  perfil?: OnboardingProfile;
  capa_config?: CapaConfig;
  estado: OnboardingStatus;
  progreso: number;
  metricas: {
    entidades: number;
    espacios: number;
    espacios_ocupados: number;
    clientes: number;
    asignaciones: number;
    reglas: number;
    cxc_mes: number;
    cxc_total: number;
    cxp_abierta: number;
    cxp_programaciones: number;
  };
  pasos: OnboardingStep[];
  cxp_entidades?: OnboardingEntityOption[];
  cxp_programaciones?: OnboardingCxpProgram[];
  catalogos_reglas?: RuleCatalogs;
  reglas_marco?: BusinessRule[];
  reglas_sugeridas: SuggestedRule[];
}

interface DashboardTask {
  id: string;
  order: number;
  module: string;
  summary: string;
  badge: string;
  priority: "Critica" | "Alta" | "Media";
  href: string;
  actionLabel: string;
  tone: "cyan" | "emerald" | "amber" | "red" | "violet";
}

interface TaskCenterResponse {
  cxc: {
    vencidas_count: number;
    vencidas_total: number;
    por_vencer_count: number;
    por_vencer_total: number;
  };
  cxp: {
    vencidos_count: number;
    vencido: number;
    por_conciliar_count: number;
    por_conciliar: number;
  };
  renta: {
    espacios_disponibles: number;
    espacios_ocupados: number;
    facturacion_activa: number;
    renta_vacante_estimada: number;
  };
}

const ONBOARDING_API = buildApiUrl("/empresas/onboarding/");
const ONBOARDING_TASKS_API = buildApiUrl("/empresas/onboarding/tareas/");
const CAPAS_API_BASE = buildApiUrl("/empresas/capas");
const FINANZAS_API_BASE = buildApiUrl("/finanzas");
const BATCH_TEMPLATE_API = buildApiUrl("/empresas/batch/plantilla/");
const BATCH_IMPORT_API = buildApiUrl("/empresas/batch/importar/");
const CXP_BATCH_TEMPLATE_API = `${FINANZAS_API_BASE}/cxp/batch/plantilla/`;
const CXP_BATCH_IMPORT_API = `${FINANZAS_API_BASE}/cxp/batch/importar/`;
const GUIDE_STORAGE_PREFIX = "betterp-onboarding-guide-finished";

const EMPTY_CAPA_FORM: CapaFormState = {
  nombre: "",
  tipo_capa: "OPERADORA",
  nombre_administrador: "",
  es_persona_moral: true,
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
  fecha_vencimiento_modo: "PENDIENTE",
  dia_vencimiento_default: "",
  dias_gracia_default: "0",
  auto_renueva_default: false,
  aplicacion_pagos: "ADEUDO_MAS_ANTIGUO",
  activo: true,
};

const EMPTY_RULE_FORM: RuleFormState = {
  id: null,
  nombre: "",
  tipo_calculo: "CARGO_FIJO",
  valor: "0",
  periodicidad: "UNICO",
  aplica_a_todos: false,
  dias_condicion: "",
  activo: true,
};

const EMPTY_CXP_PROGRAM_FORM: CxpProgramFormState = {
  id: null,
  entidad_id: "",
  nombre: "",
  categoria: "OTROS",
  naturaleza: "OPERATIVO",
  proveedor_nombre: "",
  banco_pago: "",
  cuenta_pago: "",
  clabe_pago: "",
  prioridad: "MEDIA",
  periodicidad: "MENSUAL",
  fecha_inicio: firstDayOfCurrentMonthIso(),
  fecha_fin: "",
  dia_vencimiento: "",
  monto_base: "",
  dias_gracia: "0",
  genera_recargo: false,
  prorrateable: false,
  activo: true,
  observaciones: "",
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

const CXP_CATEGORY_OPTIONS = [
  { value: "AGUA", label: "Agua" },
  { value: "LUZ", label: "Luz" },
  { value: "RENTA", label: "Renta" },
  { value: "BASURA", label: "Basura" },
  { value: "LIMPIEZA", label: "Limpieza" },
  { value: "INTERNET", label: "Internet" },
  { value: "MANTENIMIENTO", label: "Mantenimiento" },
  { value: "CONTABILIDAD", label: "Administracion / contabilidad" },
  { value: "IMPUESTOS", label: "Impuestos" },
  { value: "GAS", label: "Gas" },
  { value: "REPARACIONES", label: "Reparaciones" },
  { value: "OTROS", label: "Otros" },
];

const CXP_NATURE_OPTIONS = [
  { value: "OPERATIVO", label: "Operativo" },
  { value: "ADMINISTRATIVO", label: "Administrativo" },
];

const CXP_PRIORITY_OPTIONS = [
  { value: "BAJA", label: "Baja" },
  { value: "MEDIA", label: "Media" },
  { value: "ALTA", label: "Alta" },
  { value: "CRITICA", label: "Critica" },
];

const TIPOS_REGLA = [
  { value: "CARGO_FIJO", label: "Cargo fijo ($)" },
  { value: "DESCUENTO_FIJO", label: "Descuento fijo (-$)" },
  { value: "PORCENTAJE_RECARGO", label: "Porcentaje de recargo (+)" },
  { value: "PORCENTAJE_DESCUENTO", label: "Porcentaje de descuento (-)" },
];

const APLICACION_PAGOS = [
  { value: "ADEUDO_MAS_ANTIGUO", label: "Aplicar al adeudo mas antiguo" },
  { value: "SALDO_A_FAVOR", label: "Conservar saldo a favor" },
];

const RULES_FIELD_INFO = {
  corte: {
    title: "Modelo de corte",
    body:
      "Define si las nuevas ocupaciones usan un vencimiento global de la capa o si cada contrato conserva su propio dia de corte.",
    details: [
      "Misma fecha: util para condominios, cuotas administrativas y cargos que vencen el mismo dia.",
      "Fecha individual: util para renta, coliving u hospedaje con contratos que empiezan en dias distintos.",
    ],
  },
  diaGlobal: {
    title: "Dia global",
    body:
      "Dia del mes que BetterP usara como vencimiento base cuando el modelo de corte sea de misma fecha.",
    details: [
      "Acepta valores de 1 a 31.",
      "Solo permite numeros enteros; no acepta letras, simbolos ni decimales.",
      "Si un mes no tiene ese dia, el sistema ajusta el vencimiento al ultimo dia disponible del mes.",
    ],
  },
  periodicidad: {
    title: "Periodicidad default",
    body:
      "Frecuencia que se heredara al crear nuevas ocupaciones o cargos recurrentes desde esta capa.",
  },
  gracia: {
    title: "Dias de gracia",
    body:
      "Ventana posterior al vencimiento antes de clasificar una cuenta como vencida para cobranza y tablero.",
    details: [
      "0 dias significa que vence el mismo dia definido.",
      "Solo permite numeros enteros de 0 a 365.",
      "Usalo cuando tu operacion permite pagos pocos dias despues del corte sin tratarlo como atraso real.",
    ],
  },
  aplicacionPagos: {
    title: "Aplicacion de pagos",
    body:
      "Define como se aplicara un pago cuando el cliente tenga mas de un adeudo abierto o pague de mas.",
    details: [
      "Adeudo mas antiguo: reduce primero la cartera mas vieja.",
      "Saldo a favor: conserva excedentes para aplicarlos despues.",
    ],
  },
  renovacion: {
    title: "Renovacion automatica default",
    body:
      "Indica si las nuevas ocupaciones se renovaran automaticamente al terminar su periodo, salvo que edites una excepcion por contrato.",
  },
  plantillaReglas: {
    title: "Plantillas listas para activar",
    body:
      "Son reglas sugeridas para que el equipo tenga una base comun de cargos, recargos o descuentos desde el arranque.",
    details: [
      "Activa solo lo que realmente usaras en operacion.",
      "Cada regla seleccionada debe quedar con monto o porcentaje mayor a cero.",
    ],
  },
  tipoCalculo: {
    title: "Tipo de calculo",
    body:
      "Determina si la regla suma o descuenta un monto fijo, o si aplica un porcentaje sobre el saldo/cargo relacionado.",
  },
  valorRegla: {
    title: "Valor de la regla",
    body:
      "Monto o porcentaje que usara la regla. El significado depende del tipo de calculo seleccionado.",
    details: ["Solo acepta numeros. Puedes usar hasta 2 decimales y debe ser mayor a cero."],
  },
  diasCondicion: {
    title: "Dias condicion",
    body:
      "Numero de dias que deben pasar para aplicar la regla. Es opcional y se usa principalmente para mora o condiciones posteriores al vencimiento.",
    details: ["Solo acepta numeros enteros de 0 a 365."],
  },
} satisfies Record<string, FieldInfo>;

const STEP_FIELD_INFO = {
  datos_negocio: {
    title: "Base del negocio",
    body:
      "Define la identidad operativa principal de la capa. Estos datos se usan como referencia para equipo, comunicacion, soporte y configuraciones heredables.",
    details: [
      "Completa este paso antes de reglas, migracion y portal.",
      "Telefono solo acepta numeros y, si aplica, el signo + al inicio.",
      "Administrador y pais fiscal deben ser datos claros para operar y dar soporte.",
    ],
  },
  reglas_capa: {
    title: "Reglas heredables",
    body:
      "Configura la base que heredaran las unidades y ocupaciones nuevas: fecha de cobro, gracia, aplicacion de pagos y reglas operativas.",
    details: [
      "Este paso no debe omitirse antes de migrar la operacion.",
      "Los campos de dias solo aceptan numeros enteros, sin decimales.",
      "Las reglas base se crean en la pestaña 2.2.",
    ],
  },
  carga_batch: {
    title: "Migracion batch",
    body:
      "Permite importar unidades, espacios, clientes, ocupaciones y cartera inicial desde una plantilla controlada.",
    details: [
      "Usa la plantilla oficial para evitar columnas faltantes o formatos ambiguos.",
      "La migracion debe ocurrir despues de guardar reglas heredables.",
      "Los archivos permitidos son .xlsx, .xlsm y .csv.",
      "Si hay filas rechazadas, descarga el archivo de errores, corrige y vuelve a subir.",
    ],
  },
  cxp_batch: {
    title: "Cuentas por pagar",
    body:
      "Prepara compromisos operativos por unidad: servicios, renta, administracion, impuestos y proveedores recurrentes.",
    details: [
      "Los montos solo aceptan numeros y hasta 2 decimales.",
      "Los dias de vencimiento solo aceptan enteros de 1 a 31.",
      "La CxP ayuda al dashboard a comparar ingresos esperados contra salidas reales.",
    ],
  },
  portal_facturacion: {
    title: "Portal y facturacion",
    body:
      "Configura los datos fiscales y bancarios que vera el cliente final en su portal para pagos, comprobantes y facturacion.",
    details: [
      "El codigo postal fiscal solo acepta 5 digitos.",
      "La CLABE solo acepta 18 digitos y valida banco/digito verificador.",
      "Activa el portal cuando la cartera y datos fiscales esten revisados.",
    ],
  },
  conexiones_renta: {
    title: "Conexiones de renta",
    body:
      "Agrupa los canales donde se publicaran espacios disponibles. Debe mantenerse separado de marketing general.",
    details: [
      "Conviene completar primero inventario, fotos y datos comerciales.",
      "Starter no debe ver canales no incluidos por plan.",
      "Airbnb y Booking pueden quedar como roadmap sin bloquear el MVP.",
    ],
  },
  conexiones_marketing: {
    title: "Conexiones de marketing",
    body:
      "Agrupa redes y canales de comunicacion comercial para comunicados, calendario y publicaciones.",
    details: [
      "Facebook e Instagram deben validarse con permisos y medios correctos.",
      "WhatsApp tecnico vive en configuracion/backoffice; marketing solo debe ver uso operativo.",
      "Este paso es opcional para arrancar si la operacion ya puede cobrar y atender clientes.",
    ],
  },
  cobranza: {
    title: "Control de cobranza",
    body:
      "Revisa que la cartera generada ya refleje saldos, vencimientos, gracia y pendientes antes de comunicar cobros.",
  },
  revision_operativa: {
    title: "Revision operativa",
    body:
      "Cierre de lectura para confirmar que dashboard, cartera, CxP, portal y operacion cuentan una historia consistente.",
  },
} satisfies Record<string, FieldInfo>;

const BUSINESS_FIELD_INFO = {
  nombre: {
    title: "Nombre de la administracion",
    body:
      "Nombre operativo visible para el equipo interno. Puede ser la operadora, administradora, hotel, grupo o marca que controla la capa.",
  },
  tipoCapa: {
    title: "Tipo de capa",
    body:
      "Clasifica el modelo de negocio principal. BetterP usa esta referencia para ordenar prioridades y contexto de onboarding.",
  },
  administrador: {
    title: "Administrador responsable",
    body:
      "Persona responsable de operar o supervisar la cuenta. Usa nombre real para soporte, auditoria y seguimiento.",
    details: ["No debe capturarse como telefono, correo o identificador tecnico."],
  },
  correo: {
    title: "Correo operativo",
    body:
      "Correo principal para contacto operativo de la cuenta. Debe tener formato valido, por ejemplo operacion@empresa.com.",
  },
  telefono: {
    title: "Telefono operativo",
    body:
      "Telefono o WhatsApp de contacto para operacion. Solo acepta numeros y opcionalmente + al inicio para lada internacional.",
    details: ["Mexico normalmente usa 10 digitos; internacional permite hasta 15 digitos."],
  },
  paisFiscal: {
    title: "Pais fiscal",
    body:
      "Pais donde opera fiscalmente la capa. Se usa como base para facturacion, soporte y configuraciones fiscales.",
  },
} satisfies Record<string, FieldInfo>;

const BATCH_FIELD_INFO = {
  archivoOperacion: {
    title: "Archivo batch",
    body:
      "Archivo con unidades, espacios, clientes, ocupaciones y cartera inicial. Debe respetar la plantilla oficial.",
    details: [
      "Formatos permitidos: .xlsx, .xlsm y .csv.",
      "Si una fila tiene errores, BetterP importara las filas validas y te dejara descargar un archivo con las filas por corregir.",
    ],
  },
} satisfies Record<string, FieldInfo>;

const CXP_FIELD_INFO = {
  unidad: {
    title: "Unidad / edificio",
    body:
      "Unidad donde se crearan pagos fijos o se revisaran programaciones CxP. Cada edificio puede tener proveedores y montos distintos.",
  },
  montoBase: {
    title: "Monto base",
    body:
      "Importe estimado o real del compromiso. Solo acepta numeros y hasta 2 decimales.",
    details: ["Debe ser mayor a 0 cuando el pago fijo se va a crear."],
  },
  periodo: {
    title: "Periodo",
    body:
      "Mes operativo donde se ubicara la carga batch de CxP. Ayuda a que los compromisos queden en el periodo correcto.",
  },
  archivoCxp: {
    title: "Archivo CxP",
    body:
      "Archivo para importar proveedores y compromisos por pagar. Debe venir en .xlsx, .xlsm o .csv.",
  },
  nombrePrograma: {
    title: "Nombre",
    body:
      "Nombre corto del pago fijo, por ejemplo Luz, Agua, Renta o Limpieza.",
  },
  proveedor: {
    title: "Proveedor",
    body:
      "Empresa, persona o entidad a quien se paga el compromiso.",
  },
  diaVencimiento: {
    title: "Dia de vencimiento",
    body:
      "Dia del mes en que vence el pago recurrente. Solo acepta numeros enteros del 1 al 31.",
  },
  categoria: {
    title: "Categoria",
    body:
      "Clasifica el compromiso para reportes y lectura de gastos.",
  },
  prioridad: {
    title: "Prioridad",
    body:
      "Nivel de atencion operativa del compromiso. Usa critica para pagos que afecten servicio, inmueble o continuidad.",
  },
  naturaleza: {
    title: "Naturaleza",
    body:
      "Distingue compromisos operativos de administrativos para analisis y control interno.",
  },
  periodicidad: {
    title: "Periodicidad",
    body:
      "Frecuencia con la que se repite el compromiso.",
  },
  activo: {
    title: "Activo",
    body:
      "Si esta desactivado, BetterP conserva el registro pero no lo considera vigente para nuevas lecturas.",
  },
  recargo: {
    title: "Genera recargo",
    body:
      "Marca esta opcion si el proveedor cobra penalizacion por atraso.",
  },
} satisfies Record<string, FieldInfo>;

const PORTAL_FIELD_INFO = {
  tipoPersona: {
    title: "Tipo de persona fiscal",
    body:
      "Define si la facturacion sera para persona fisica o moral. Esto ajusta longitud esperada de RFC y catalogo de regimenes.",
  },
  razonSocial: {
    title: "Nombre / razon social",
    body:
      "Nombre fiscal de la persona fisica o razon social de la persona moral que recibira facturas. Puede ser distinto al ocupante o cliente operativo.",
  },
  rfc: {
    title: "RFC",
    body:
      "Clave fiscal del receptor. Persona moral usa 12 caracteres y persona fisica usa 13.",
  },
  regimenFiscal: {
    title: "Regimen fiscal",
    body:
      "Regimen SAT del receptor fiscal. Debe corresponder al tipo de persona seleccionado.",
  },
  codigoPostal: {
    title: "Codigo postal fiscal",
    body:
      "Codigo postal del domicilio fiscal. Solo acepta 5 digitos.",
  },
  banco: {
    title: "Banco",
    body:
      "Banco de la cuenta donde los clientes realizaran transferencias.",
  },
  clabe: {
    title: "CLABE",
    body:
      "Cuenta CLABE para transferencias. Solo acepta 18 digitos y BetterP valida banco/digito verificador.",
  },
  beneficiario: {
    title: "Beneficiario",
    body:
      "Nombre del titular que recibira el pago por transferencia.",
  },
  referencia: {
    title: "Prefijo de referencia",
    body:
      "Prefijo alfanumerico que ayuda a identificar pagos. Acepta de 2 a 12 letras o numeros.",
  },
  portalActivo: {
    title: "Portal de clientes activo",
    body:
      "Controla si el cliente final puede consultar saldos, datos de pago, comprobantes y facturacion desde su portal.",
  },
} satisfies Record<string, FieldInfo>;

const RULE_FORM_FIELD_INFO = {
  nombre: {
    title: "Nombre de la regla",
    body:
      "Nombre operativo de la regla heredable. Debe ser claro para que el equipo sepa cuando usarla.",
  },
  periodicidad: {
    title: "Periodicidad",
    body:
      "Frecuencia con la que aplica la regla: unica, semanal, quincenal, mensual u otra opcion del catalogo.",
  },
  aplicaATodos: {
    title: "Aplica a todos",
    body:
      "Cuando esta activo, la regla queda disponible como base general para nuevas unidades u ocupaciones.",
  },
  reglaActiva: {
    title: "Regla activa",
    body:
      "Si esta inactiva, BetterP conserva la regla como referencia pero no la considera vigente.",
  },
} satisfies Record<string, FieldInfo>;

const OPERACION_HINTS = [
  {
    title: "Condominios o cuotas administrativas",
    copy: "Normalmente todos pagan el mismo dia y el sistema puede heredar un vencimiento global.",
  },
  {
    title: "Rentas, coliving u hospedaje",
    copy: "Cada contrato suele tener su propia fecha de corte; el batch puede traerla por cliente.",
  },
];

const CXP_FIXED_PAYMENT_PRESETS = [
  {
    key: "agua",
    label: "Agua",
    categoria: "AGUA",
    naturaleza: "OPERATIVO",
    proveedor: "Organismo de agua",
    proveedoresMx: "SACMEX, SIAPA, Agua de Puebla, CESPT u organismo local",
    prioridad: "ALTA",
    generaRecargo: true,
  },
  {
    key: "luz",
    label: "Luz",
    categoria: "LUZ",
    naturaleza: "OPERATIVO",
    proveedor: "CFE",
    proveedoresMx: "CFE",
    prioridad: "ALTA",
    generaRecargo: true,
  },
  {
    key: "renta",
    label: "Renta",
    categoria: "RENTA",
    naturaleza: "OPERATIVO",
    proveedor: "Arrendador",
    proveedoresMx: "Arrendador, fideicomiso o administracion propietaria",
    prioridad: "CRITICA",
    generaRecargo: true,
  },
  {
    key: "predial",
    label: "Predial",
    categoria: "IMPUESTOS",
    naturaleza: "ADMINISTRATIVO",
    proveedor: "Municipio / Tesoreria",
    proveedoresMx: "Tesoreria CDMX, tesoreria estatal o municipio",
    prioridad: "ALTA",
    generaRecargo: true,
  },
  {
    key: "cuota_mantenimiento",
    label: "Cuota de mantenimiento",
    categoria: "MANTENIMIENTO",
    naturaleza: "OPERATIVO",
    proveedor: "Administracion del inmueble",
    proveedoresMx: "Comite, administradora o proveedor de mantenimiento",
    prioridad: "ALTA",
    generaRecargo: true,
  },
  {
    key: "cuota_administracion",
    label: "Cuota de administracion",
    categoria: "CONTABILIDAD",
    naturaleza: "ADMINISTRATIVO",
    proveedor: "Administradora",
    proveedoresMx: "Administradora interna, despacho contable o backoffice",
    prioridad: "ALTA",
    generaRecargo: false,
  },
  {
    key: "impuesto_hospedaje",
    label: "Impuesto sobre hospedaje",
    categoria: "IMPUESTOS",
    naturaleza: "ADMINISTRATIVO",
    proveedor: "Secretaria de Finanzas estatal",
    proveedoresMx: "Secretaria de Finanzas estatal / ISH",
    prioridad: "ALTA",
    generaRecargo: true,
  },
  {
    key: "basura",
    label: "Recoleccion de basura",
    categoria: "BASURA",
    naturaleza: "OPERATIVO",
    proveedor: "Proveedor de recoleccion",
    proveedoresMx: "Municipio, recolector local o proveedor privado",
    prioridad: "MEDIA",
    generaRecargo: false,
  },
  {
    key: "limpieza",
    label: "Limpieza",
    categoria: "LIMPIEZA",
    naturaleza: "OPERATIVO",
    proveedor: "Proveedor de limpieza",
    proveedoresMx: "Equipo interno, outsourcing o proveedor local",
    prioridad: "ALTA",
    generaRecargo: false,
  },
  {
    key: "internet",
    label: "Internet",
    categoria: "INTERNET",
    naturaleza: "OPERATIVO",
    proveedor: "Proveedor de internet",
    proveedoresMx: "Telmex, Totalplay, Izzi, Megacable, AT&T",
    prioridad: "MEDIA",
    generaRecargo: false,
  },
];

const PERSONA_FISCAL_OPTIONS = [
  { value: "moral", label: "Persona moral" },
  { value: "fisica", label: "Persona fisica" },
];

const MONTH_PICKER_OPTIONS = [
  { value: "01", short: "Ene", label: "Enero" },
  { value: "02", short: "Feb", label: "Febrero" },
  { value: "03", short: "Mar", label: "Marzo" },
  { value: "04", short: "Abr", label: "Abril" },
  { value: "05", short: "May", label: "Mayo" },
  { value: "06", short: "Jun", label: "Junio" },
  { value: "07", short: "Jul", label: "Julio" },
  { value: "08", short: "Ago", label: "Agosto" },
  { value: "09", short: "Sep", label: "Septiembre" },
  { value: "10", short: "Oct", label: "Octubre" },
  { value: "11", short: "Nov", label: "Noviembre" },
  { value: "12", short: "Dic", label: "Diciembre" },
];

const MEXICAN_BANKS = [
  { code: "", label: "Selecciona banco" },
  { code: "002", label: "Banamex" },
  { code: "012", label: "BBVA Mexico" },
  { code: "014", label: "Santander" },
  { code: "021", label: "HSBC" },
  { code: "030", label: "Banco del Bajio" },
  { code: "036", label: "Inbursa" },
  { code: "042", label: "Mifel" },
  { code: "044", label: "Scotiabank" },
  { code: "058", label: "Banregio" },
  { code: "062", label: "Afirme" },
  { code: "072", label: "Banorte" },
  { code: "103", label: "American Express" },
  { code: "112", label: "Monex" },
  { code: "113", label: "Ve por Mas" },
  { code: "127", label: "Banco Azteca" },
  { code: "130", label: "Compartamos Banco" },
  { code: "132", label: "Multiva" },
  { code: "133", label: "Actinver" },
  { code: "136", label: "Intercam Banco" },
  { code: "137", label: "BanCoppel" },
  { code: "143", label: "CIBanco" },
  { code: "145", label: "Banco Base" },
  { code: "646", label: "STP" },
  { code: "OTRO", label: "Otro banco / no listado" },
];

const BANK_OPTIONS = MEXICAN_BANKS.map((bank) => ({
  value: bank.code ? bank.label : "",
  label: bank.label,
}));

function bankOptionsForValue(value: string) {
  if (!value || BANK_OPTIONS.some((option) => option.value === value)) {
    return BANK_OPTIONS;
  }
  return [{ value, label: value }, ...BANK_OPTIONS];
}

const GUIDE_COPY: Record<
  string,
  {
    abc: string;
    objetivo: string;
    captura: string[];
    resultado: string;
    consejo: string;
  }
> = {
  datos_negocio: {
    abc: "A. Base del negocio",
    objetivo:
      "Dejar clara la capa operativa principal: quien administra, como se identifica el negocio y que datos se usaran como base.",
    captura: [
      "Nombre de la administracion u operadora.",
      "Correo y telefono operativo.",
      "Datos fiscales si esta capa emitira o concentrara facturacion.",
    ],
    resultado:
      "Las unidades de negocio heredaran una identidad y una base fiscal consistente.",
    consejo:
      "Si administras varias unidades, piensa en esta capa como la matriz de reglas y datos generales.",
  },
  reglas_capa: {
    abc: "B. Reglas heredables",
    objetivo:
      "Definir las politicas que se repetiran en la operacion: cobro, gracia, mora, penalizaciones y cargos extraordinarios.",
    captura: [
      "Periodicidad de cobro y dias de gracia.",
      "Interes moratorio o recargo por atraso.",
      "Plantillas para penalizaciones, depositos, amenities y cargos unicos.",
    ],
    resultado:
      "Cada unidad puede arrancar con reglas listas y solo personalizar excepciones.",
    consejo:
      "Conviene crear reglas base aunque algunas queden en $0; sirven como plantilla operativa para el equipo.",
  },
  carga_batch: {
    abc: "C. Migracion agil",
    objetivo:
      "Cargar la operacion real desde Excel para evitar capturas manuales y errores de arranque.",
    captura: [
      "Unidades de negocio y ciudad.",
      "Espacios, renta, deposito, estatus y tipo.",
      "Clientes, WhatsApp, correo, contrato y fecha de corte.",
    ],
    resultado:
      "BetterP crea entidades, espacios, clientes, ocupacion y cartera inicial con una sola carga.",
    consejo:
      "Esta debe ser la ruta principal de arranque. Crear uno por uno funciona, pero escala peor y genera mas soporte.",
  },
  cxp_batch: {
    abc: "D. Cuentas por pagar",
    objetivo:
      "Preparar los compromisos que la administracion debe pagar: gastos fijos recurrentes, proveedores principales y carga batch de CxP.",
    captura: [
      "Unidad o edificio donde aplicaran los gastos.",
      "Pagos fijos como agua, luz, renta, basura, limpieza e internet.",
      "Plantilla batch para compromisos operativos masivos.",
    ],
    resultado:
      "El dashboard podra contrastar ingresos esperados contra compromisos reales por pagar.",
    consejo:
      "Usa un estimado mayor a cero cuando aun no tengas el importe final; despues puedes editar cada programacion por edificio.",
  },
  portal_facturacion: {
    abc: "E. Portal y facturacion",
    objetivo:
      "Preparar lo que el cliente final vera: historial, datos fiscales, facturas y comprobantes.",
    captura: [
      "Datos fiscales completos.",
      "Banco, CLABE y referencia de pago.",
      "Portal de clientes activo cuando la cartera este validada.",
    ],
    resultado:
      "El cliente final puede autoservirse y tu equipo recibe menos solicitudes repetitivas.",
    consejo:
      "Activa el portal cuando ya tengas datos limpios; asi evitas mostrar informacion incompleta al cliente final.",
  },
  conexiones_renta: {
    abc: "F. Conexiones de renta",
    objetivo:
      "Conectar los canales donde se publicaran espacios disponibles, empezando por Mercado Libre y marketplaces inmobiliarios.",
    captura: [
      "Cuenta de Mercado Libre para publicar inmuebles.",
      "Reglas de publicacion y pausa cuando el espacio se ocupe.",
      "Canales de renta adicionales cuando esten disponibles.",
    ],
    resultado:
      "Los espacios disponibles quedan listos para publicarse sin mezclar esta configuracion con marketing general.",
    consejo:
      "Haz esta conexion despues de cargar espacios y fotos; asi la publicacion sale con inventario real.",
  },
  conexiones_marketing: {
    abc: "G. Conexiones de marketing",
    objetivo:
      "Conectar redes sociales para comunicados, difusion y contenido comercial de la operacion.",
    captura: [
      "Facebook Pages para publicar texto, imagenes o enlaces.",
      "Instagram Business con multimedia obligatoria.",
      "Estado de canales y permisos de cada red.",
    ],
    resultado:
      "El equipo puede programar comunicados y publicaciones sin duplicar la configuracion tecnica de renta.",
    consejo:
      "Manten WhatsApp tecnico en configuracion/backoffice; en marketing solo debe verse el estado y el uso operativo.",
  },
};

function statusLabel(status: OnboardingStatus) {
  if (status === "COMPLETO") return "Completo";
  if (status === "EN_PROCESO") return "En proceso";
  return "Pendiente";
}

function statusClasses(status: OnboardingStatus) {
  if (status === "COMPLETO") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
  }
  if (status === "EN_PROCESO") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-200";
  }
  return "border-zinc-800 bg-zinc-900 text-zinc-400";
}

const OPTIONAL_ONBOARDING_STEPS = new Set(["conexiones_renta", "conexiones_marketing"]);

function isOnboardingStepOptional(step: OnboardingStep) {
  return OPTIONAL_ONBOARDING_STEPS.has(step.id);
}

function isOnboardingStepComplete(step: OnboardingStep) {
  return step.estado === "COMPLETO";
}

function stepGateMessage(step: OnboardingStep) {
  if (step.id === "reglas_capa") {
    return "Antes de migrar la operacion del cliente, deja listas las reglas heredables. Asi cada unidad de negocio nace con la misma base de cobro, gracia y cargos.";
  }
  if (step.id === "carga_batch") {
    return "Completa la migracion base antes de preparar CxP, portal, renta o marketing. Es lo que crea unidades, espacios, clientes y cartera inicial.";
  }
  if (step.id === "datos_negocio") {
    return "Primero guarda los datos base de la administracion. Los siguientes pasos heredan esta identidad operativa.";
  }
  return "Este paso es obligatorio en el orden del onboarding. Completalo antes de avanzar al siguiente modulo.";
}

const CAPA_SAVE_STEPS = new Set(["datos_negocio", "reglas_capa", "portal_facturacion"]);

function isCapaSaveStep(stepId: string) {
  return CAPA_SAVE_STEPS.has(stepId);
}

function capaStepSaveNotice(stepId: string) {
  if (stepId === "datos_negocio") {
    return "Se guardaron los datos del negocio.";
  }
  if (stepId === "portal_facturacion") {
    return "Se guardaron portal y facturacion.";
  }
  return "Se guardaron las reglas generales.";
}

function validateCapaStepForm(
  stepId: string,
  form: CapaFormState,
  dueMode: GlobalDueMode
) {
  if (stepId === "datos_negocio") {
    return validateBusinessDataForm(form);
  }
  if (stepId === "reglas_capa") {
    return validateRulesForm(form, dueMode);
  }
  if (stepId === "portal_facturacion") {
    return validatePortalBillingForm(form);
  }
  return {};
}

function ruleValueLabel(rule: SuggestedRule) {
  if (rule.tipo_calculo.includes("PORCENTAJE")) {
    return `${rule.valor}%`;
  }
  return `$${rule.valor.toLocaleString("es-MX")}`;
}

function businessRuleValueLabel(rule: Pick<BusinessRule, "tipo_calculo" | "valor">) {
  if (rule.tipo_calculo.includes("PORCENTAJE")) {
    return `${Number(rule.valor || 0).toLocaleString("es-MX")}%`;
  }
  return `$${Number(rule.valor || 0).toLocaleString("es-MX")}`;
}

function ruleConditionLabel(rule: Pick<BusinessRule, "aplica_a_todos" | "dias_condicion">) {
  const scope = rule.aplica_a_todos ? "Aplica a todos" : "Aplicacion manual";
  if (rule.dias_condicion === null || rule.dias_condicion === undefined) {
    return scope;
  }
  return `${scope} - desde dia ${rule.dias_condicion}`;
}

function mapRuleToForm(rule: BusinessRule): RuleFormState {
  return {
    id: rule.id,
    nombre: safeText(rule.nombre),
    tipo_calculo: safeText(rule.tipo_calculo, "CARGO_FIJO"),
    valor: String(rule.valor ?? 0),
    periodicidad: safeText(rule.periodicidad, "UNICO"),
    aplica_a_todos: Boolean(rule.aplica_a_todos),
    dias_condicion:
      rule.dias_condicion !== null && rule.dias_condicion !== undefined
        ? String(rule.dias_condicion)
        : "",
    activo: Boolean(rule.activo),
  };
}

function mapSuggestedRuleToForm(rule: SuggestedRule): RuleFormState {
  return {
    id: null,
    nombre: safeText(rule.nombre),
    tipo_calculo: safeText(rule.tipo_calculo, "CARGO_FIJO"),
    valor: String(rule.valor ?? 0),
    periodicidad: safeText(rule.periodicidad, "UNICO"),
    aplica_a_todos: Boolean(rule.aplica_a_todos),
    dias_condicion:
      rule.dias_condicion !== null && rule.dias_condicion !== undefined
        ? String(rule.dias_condicion)
        : "",
    activo: true,
  };
}

function buildRulePayload(form: RuleFormState) {
  const valor = Number(String(form.valor || "0").replace(",", "."));
  return {
    nombre: safeText(form.nombre).trim(),
    tipo_calculo: form.tipo_calculo || "CARGO_FIJO",
    valor: Number.isFinite(valor) ? valor : 0,
    periodicidad: form.periodicidad || "UNICO",
    aplica_a_todos: form.aplica_a_todos,
    dias_condicion: parseOptionalInteger(form.dias_condicion),
    activo: form.activo,
  };
}

function parseOptionalInteger(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function parseMoneyInput(value: string | number | null | undefined) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeIntegerInput(value: string, maxLength = 6) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function sanitizeMoneyInput(value: string) {
  const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
  const [integerPart, ...decimalParts] = normalized.split(".");
  const decimals = decimalParts.join("").slice(0, 2);
  return decimalParts.length > 0 ? `${integerPart}.${decimals}` : integerPart;
}

function sanitizePhoneInput(value: string) {
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "").slice(0, 15);
  return `${hasPlus ? "+" : ""}${digits}`;
}

function sanitizeAlphaNumeric(value: string, maxLength: number) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, maxLength);
}

function sanitizeLettersInput(value: string, maxLength: number) {
  return value.replace(/[^\p{L}\s'.-]/gu, "").slice(0, maxLength);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value.trim());
}

function fieldLengthMessage(value: string, label: string, min: number, max: number) {
  const length = value.trim().length;
  if (length < min) return `${label} debe tener al menos ${min} caracteres.`;
  if (length > max) return `${label} no debe superar ${max} caracteres.`;
  return "";
}

function validateIntegerRange(
  value: string,
  label: string,
  min: number,
  max: number,
  required = true
) {
  const trimmed = value.trim();
  if (!trimmed) {
    return required ? `${label} es obligatorio. Solo acepta numeros de ${min} a ${max}.` : "";
  }
  if (!/^\d+$/.test(trimmed)) {
    return `${label} solo acepta numeros enteros de ${min} a ${max}.`;
  }
  const parsed = Number(trimmed);
  if (parsed < min || parsed > max) {
    return `${label} debe estar entre ${min} y ${max}.`;
  }
  return "";
}

function validateMoneyRange(value: string, label: string, min: number, max: number) {
  const trimmed = value.trim();
  if (!trimmed) return `${label} es obligatorio. Solo acepta numeros y hasta 2 decimales.`;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return `${label} solo acepta numeros y hasta 2 decimales.`;
  }
  const parsed = parseMoneyInput(trimmed);
  if (parsed < min || parsed > max) {
    return `${label} debe estar entre ${min} y ${max}.`;
  }
  return "";
}

function isPercentageRuleType(type: string) {
  return type.includes("PORCENTAJE");
}

function ruleValueFieldLabel(type: string) {
  return isPercentageRuleType(type) ? "Porcentaje" : "Monto";
}

function validateBusinessRuleValue(form: RuleFormState) {
  const label = ruleValueFieldLabel(form.tipo_calculo);
  const error = validateMoneyRange(form.valor, label, 0, 10000000);
  if (error) return error;
  const parsed = parseMoneyInput(form.valor);
  if (parsed <= 0) {
    return isPercentageRuleType(form.tipo_calculo)
      ? "Porcentaje debe ser mayor a 0."
      : "Monto debe ser mayor a 0.";
  }
  return "";
}

function businessRuleValueHelper(type: string) {
  return isPercentageRuleType(type)
    ? "Solo numeros. Usa hasta 2 decimales y un porcentaje mayor a 0."
    : "Solo numeros. Usa hasta 2 decimales y un monto mayor a 0.";
}

function validateBusinessDataForm(form: CapaFormState) {
  const errors: Partial<Record<keyof CapaFormState, string>> = {};
  errors.nombre = fieldLengthMessage(form.nombre, "Nombre de la administracion", 3, 120);
  errors.nombre_administrador = fieldLengthMessage(
    form.nombre_administrador,
    "Administrador responsable",
    3,
    120
  );
  if (!errors.nombre_administrador && /\d/.test(form.nombre_administrador)) {
    errors.nombre_administrador =
      "Administrador responsable solo acepta letras, espacios y signos basicos de nombre.";
  }
  if (!form.correo_contacto.trim()) {
    errors.correo_contacto = "Correo operativo es obligatorio.";
  } else if (!isValidEmail(form.correo_contacto)) {
    errors.correo_contacto = "Captura un correo valido, por ejemplo operacion@empresa.com.";
  }
  const phoneDigits = form.telefono_contacto.replace(/\D/g, "");
  if (!phoneDigits) {
    errors.telefono_contacto = "Telefono operativo es obligatorio.";
  } else if (phoneDigits.length < 10 || phoneDigits.length > 15) {
    errors.telefono_contacto = "Captura un telefono valido de 10 a 15 digitos.";
  }
  errors.pais_fiscal = fieldLengthMessage(form.pais_fiscal, "Pais fiscal", 2, 80);
  if (!errors.pais_fiscal && /\d/.test(form.pais_fiscal)) {
    errors.pais_fiscal = "Pais fiscal solo acepta letras y espacios.";
  }
  Object.keys(errors).forEach((key) => {
    if (!errors[key as keyof CapaFormState]) delete errors[key as keyof CapaFormState];
  });
  return errors;
}

function validateRulesForm(form: CapaFormState, dueMode: GlobalDueMode) {
  const errors: Partial<Record<keyof CapaFormState, string>> = {};
  if (dueMode === "global") {
    errors.dia_vencimiento_default = validateIntegerRange(
      form.dia_vencimiento_default,
      "Dia global",
      1,
      31
    );
  }
  errors.dias_gracia_default = validateIntegerRange(
    form.dias_gracia_default,
    "Dias de gracia",
    0,
    365
  );
  if (!form.periodicidad_cobro_default) {
    errors.periodicidad_cobro_default = "Periodicidad default es obligatoria.";
  }
  if (!form.aplicacion_pagos) {
    errors.aplicacion_pagos = "Aplicacion de pagos es obligatoria.";
  }
  Object.keys(errors).forEach((key) => {
    if (!errors[key as keyof CapaFormState]) delete errors[key as keyof CapaFormState];
  });
  return errors;
}

function validateBusinessRuleForm(form: RuleFormState) {
  const errors: Partial<Record<keyof RuleFormState, string>> = {};
  errors.nombre = fieldLengthMessage(form.nombre, "Nombre", 3, 80);
  errors.valor = validateBusinessRuleValue(form);
  errors.dias_condicion = validateIntegerRange(
    form.dias_condicion,
    "Dias condicion",
    0,
    365,
    false
  );
  Object.keys(errors).forEach((key) => {
    if (!errors[key as keyof RuleFormState]) delete errors[key as keyof RuleFormState];
  });
  return errors;
}

function validatePortalBillingForm(form: CapaFormState) {
  const errors: Partial<Record<keyof CapaFormState, string>> = {};
  errors.razon_social = fieldLengthMessage(
    form.razon_social,
    "Nombre / razon social",
    3,
    160
  );
  const expectedRfcLength = form.es_persona_moral ? 12 : 13;
  if (!form.rfc.trim()) {
    errors.rfc = "RFC es obligatorio.";
  } else if (form.rfc.trim().length !== expectedRfcLength) {
    errors.rfc = `RFC debe tener ${expectedRfcLength} caracteres para ${
      form.es_persona_moral ? "persona moral" : "persona fisica"
    }.`;
  }
  if (!form.regimen_fiscal) {
    errors.regimen_fiscal = "Regimen fiscal es obligatorio.";
  }
  if (!/^\d{5}$/.test(form.codigo_postal_fiscal.trim())) {
    errors.codigo_postal_fiscal = "Codigo postal fiscal debe tener 5 digitos.";
  }
  if (!form.banco_transferencias.trim()) {
    errors.banco_transferencias = "Banco es obligatorio.";
  }
  const clabeStatus = validateClabe(form.clabe_transferencias);
  if (!form.clabe_transferencias.trim()) {
    errors.clabe_transferencias = "CLABE es obligatoria.";
  } else if (clabeStatus.status === "error") {
    errors.clabe_transferencias = clabeStatus.message;
  }
  errors.beneficiario_transferencias = fieldLengthMessage(
    form.beneficiario_transferencias,
    "Beneficiario",
    3,
    120
  );
  if (!/^[A-Z0-9]{2,12}$/.test(form.referencia_transferencia_prefijo.trim())) {
    errors.referencia_transferencia_prefijo =
      "Prefijo de referencia debe tener 2 a 12 letras o numeros.";
  }
  Object.keys(errors).forEach((key) => {
    if (!errors[key as keyof CapaFormState]) delete errors[key as keyof CapaFormState];
  });
  return errors;
}

function validateCxpProgramForm(form: CxpProgramFormState) {
  const errors: Partial<Record<keyof CxpProgramFormState, string>> = {};
  if (!form.entidad_id) errors.entidad_id = "Selecciona unidad de negocio.";
  errors.nombre = fieldLengthMessage(form.nombre, "Nombre", 3, 100);
  errors.proveedor_nombre = fieldLengthMessage(form.proveedor_nombre, "Proveedor", 2, 120);
  errors.monto_base = validateMoneyRange(form.monto_base, "Monto base", 1, 100000000);
  errors.dia_vencimiento = validateIntegerRange(
    form.dia_vencimiento,
    "Dia de vencimiento",
    1,
    31
  );
  errors.dias_gracia = validateIntegerRange(
    form.dias_gracia,
    "Dias de gracia",
    0,
    365
  );
  if (!form.categoria) errors.categoria = "Categoria es obligatoria.";
  if (!form.prioridad) errors.prioridad = "Prioridad es obligatoria.";
  if (!form.naturaleza) errors.naturaleza = "Naturaleza es obligatoria.";
  if (!form.periodicidad) errors.periodicidad = "Periodicidad es obligatoria.";
  if (!form.fecha_inicio) errors.fecha_inicio = "Fecha inicio es obligatoria.";
  if (form.fecha_inicio && form.fecha_fin && form.fecha_fin < form.fecha_inicio) {
    errors.fecha_fin = "Fecha fin no puede ser anterior a fecha inicio.";
  }
  if (form.banco_pago.trim().length > 80) {
    errors.banco_pago = "Banco no debe superar 80 caracteres.";
  }
  if (form.cuenta_pago.trim().length > 40) {
    errors.cuenta_pago = "Cuenta no debe superar 40 caracteres.";
  }
  if (form.clabe_pago.trim() && !/^\d{18}$/.test(form.clabe_pago.trim())) {
    errors.clabe_pago = "CLABE debe tener 18 digitos numericos.";
  }
  if (form.observaciones.length > 600) {
    errors.observaciones = "Notas operativas no debe superar 600 caracteres.";
  }
  Object.keys(errors).forEach((key) => {
    if (!errors[key as keyof CxpProgramFormState]) {
      delete errors[key as keyof CxpProgramFormState];
    }
  });
  return errors;
}

function hasValidationErrors(errors: Partial<Record<string, string>>) {
  return Object.values(errors).some(Boolean);
}

function mapCxpProgramToForm(program: OnboardingCxpProgram): CxpProgramFormState {
  return {
    id: program.id,
    entidad_id: String(program.entidad_id),
    nombre: safeText(program.nombre),
    categoria: safeText(program.categoria, "OTROS"),
    naturaleza: safeText(program.naturaleza, "OPERATIVO"),
    proveedor_nombre: safeText(program.proveedor_nombre),
    banco_pago: safeText(program.banco_pago),
    cuenta_pago: safeText(program.cuenta_pago),
    clabe_pago: safeText(program.clabe_pago),
    prioridad: safeText(program.prioridad, "MEDIA"),
    periodicidad: safeText(program.periodicidad, "MENSUAL"),
    fecha_inicio: safeText(program.fecha_inicio, firstDayOfCurrentMonthIso()),
    fecha_fin: safeText(program.fecha_fin),
    dia_vencimiento:
      program.dia_vencimiento !== null && program.dia_vencimiento !== undefined
        ? String(program.dia_vencimiento)
        : "",
    monto_base: String(program.monto_base ?? ""),
    dias_gracia: String(program.dias_gracia ?? 0),
    genera_recargo: Boolean(program.genera_recargo),
    prorrateable: Boolean(program.prorrateable),
    activo: Boolean(program.activo),
    observaciones: safeText(program.observaciones),
  };
}

function mapCxpPresetToForm(
  preset: (typeof CXP_FIXED_PAYMENT_PRESETS)[number],
  amount: number,
  capaForm: CapaFormState,
  entidadId = ""
): CxpProgramFormState {
  return {
    ...EMPTY_CXP_PROGRAM_FORM,
    entidad_id: entidadId,
    nombre: preset.label,
    categoria: preset.categoria,
    naturaleza: preset.naturaleza,
    proveedor_nombre: preset.proveedor,
    prioridad: preset.prioridad,
    periodicidad: "MENSUAL",
    fecha_inicio: firstDayOfCurrentMonthIso(),
    dia_vencimiento: String(
      parseOptionalInteger(capaForm.dia_vencimiento_default) ?? ""
    ),
    monto_base: amount > 0 ? String(amount) : "",
    dias_gracia: String(parseOptionalInteger(capaForm.dias_gracia_default) ?? 0),
    genera_recargo: preset.generaRecargo,
    activo: true,
    observaciones: `Plantilla de onboarding. Proveedores MX sugeridos: ${preset.proveedoresMx}.`,
  };
}

function defaultCxpProgramForm(
  capaForm: CapaFormState,
  entidadId = ""
): CxpProgramFormState {
  return {
    ...EMPTY_CXP_PROGRAM_FORM,
    entidad_id: entidadId,
    periodicidad: capaForm.periodicidad_cobro_default || "MENSUAL",
    fecha_inicio: firstDayOfCurrentMonthIso(),
    dia_vencimiento: String(
      parseOptionalInteger(capaForm.dia_vencimiento_default) ?? ""
    ),
    dias_gracia: String(parseOptionalInteger(capaForm.dias_gracia_default) ?? 0),
  };
}

function buildCxpProgramPayload(form: CxpProgramFormState) {
  return {
    nombre: safeText(form.nombre).trim(),
    categoria: form.categoria || "OTROS",
    naturaleza: form.naturaleza || "OPERATIVO",
    proveedor_nombre: safeText(form.proveedor_nombre).trim(),
    banco_pago: safeText(form.banco_pago).trim(),
    cuenta_pago: safeText(form.cuenta_pago).trim(),
    clabe_pago: safeText(form.clabe_pago).trim(),
    prioridad: form.prioridad || "MEDIA",
    periodicidad: form.periodicidad || "MENSUAL",
    fecha_inicio: form.fecha_inicio || firstDayOfCurrentMonthIso(),
    fecha_fin: form.fecha_fin || null,
    dia_vencimiento: parseOptionalInteger(form.dia_vencimiento),
    monto_base: parseMoneyInput(form.monto_base),
    dias_gracia: parseOptionalInteger(form.dias_gracia) ?? 0,
    genera_recargo: form.genera_recargo,
    prorrateable: form.prorrateable,
    activo: form.activo,
    observaciones: safeText(form.observaciones).trim(),
  };
}

function safeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function clabeControlDigit(clabePrefix: string) {
  const weights = [3, 7, 1];
  const total = clabePrefix
    .split("")
    .reduce((sum, character, index) => {
      const digit = Number(character);
      if (!Number.isFinite(digit)) return sum;
      return sum + ((digit * weights[index % weights.length]) % 10);
    }, 0);
  return (10 - (total % 10)) % 10;
}

function getBankFromClabe(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return MEXICAN_BANKS.find((bank) => bank.code === digits.slice(0, 3)) || null;
}

function validateClabe(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return { status: "empty" as const, message: "" };
  }
  if (digits.length !== 18) {
    return {
      status: "error" as const,
      message: `La CLABE debe tener 18 digitos. Capturados: ${digits.length}.`,
    };
  }
  if (clabeControlDigit(digits.slice(0, 17)) !== Number(digits.slice(-1))) {
    return {
      status: "error" as const,
      message: "La CLABE no supera el digito verificador bancario.",
    };
  }
  const bank = getBankFromClabe(digits);
  if (!bank || !bank.code) {
    return {
      status: "warning" as const,
      message: "CLABE valida, pero el banco no esta en el catalogo base.",
    };
  }
  return {
    status: "ok" as const,
    message: `CLABE valida. Banco detectado: ${bank.label}.`,
  };
}

function todayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function monthIso() {
  return todayIso().slice(0, 7);
}

function parseMonthPeriod(value: string) {
  const [yearValue, monthValue] = value.split("-");
  const parsedYear = Number.parseInt(yearValue, 10);
  const year = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear();
  const month =
    MONTH_PICKER_OPTIONS.find((item) => item.value === monthValue)?.value ||
    monthIso().slice(5, 7);
  return { year, month };
}

function firstDayOfCurrentMonthIso() {
  return `${monthIso()}-01`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

async function readResponseBody(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function getErrorMessage(body: unknown, fallback: string) {
  if (typeof body === "string" && body.trim()) {
    return body.trim();
  }
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
  const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    return decodeURIComponent(utfMatch[1].replace(/"/g, ""));
  }
  const match = contentDisposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}

function mapCapaToForm(capa: Partial<CapaConfig>): CapaFormState {
  return {
    nombre: safeText(capa.nombre),
    tipo_capa: safeText(capa.tipo_capa, "OPERADORA"),
    nombre_administrador: safeText(capa.nombre_administrador),
    es_persona_moral: capa.es_persona_moral ?? true,
    razon_social: safeText(capa.razon_social),
    rfc: safeText(capa.rfc),
    regimen_fiscal: safeText(capa.regimen_fiscal),
    correo_contacto: safeText(capa.correo_contacto),
    telefono_contacto: safeText(capa.telefono_contacto),
    logo_url: safeText(capa.logo_url),
    pais_fiscal: safeText(capa.pais_fiscal, "Mexico"),
    codigo_postal_fiscal: safeText(capa.codigo_postal_fiscal),
    estado_fiscal: safeText(capa.estado_fiscal),
    municipio_fiscal: safeText(capa.municipio_fiscal),
    colonia_fiscal: safeText(capa.colonia_fiscal),
    calle_fiscal: safeText(capa.calle_fiscal),
    numero_exterior_fiscal: safeText(capa.numero_exterior_fiscal),
    numero_interior_fiscal: safeText(capa.numero_interior_fiscal),
    facturacion_activa: Boolean(capa.facturacion_activa),
    facturacion_modo: safeText(capa.facturacion_modo, "MANUAL"),
    facturacion_pac_proveedor: safeText(
      capa.facturacion_pac_proveedor,
      "SIN_PROVEEDOR"
    ),
    facturacion_serie_ingresos: safeText(capa.facturacion_serie_ingresos, "A"),
    facturacion_lugar_expedicion: safeText(
      capa.facturacion_lugar_expedicion
    ),
    facturacion_producto_servicio: safeText(
      capa.facturacion_producto_servicio
    ),
    facturacion_unidad: safeText(capa.facturacion_unidad, "E48"),
    facturacion_uso_cfdi_default: safeText(
      capa.facturacion_uso_cfdi_default,
      "G03"
    ),
    facturacion_metodo_pago_default: safeText(
      capa.facturacion_metodo_pago_default,
      "PUE"
    ),
    facturacion_forma_pago_default: safeText(
      capa.facturacion_forma_pago_default,
      "03"
    ),
    portal_clientes_activo: Boolean(capa.portal_clientes_activo),
    portal_clientes_url_base: safeText(capa.portal_clientes_url_base),
    seguridad_doble_factor_activa: Boolean(capa.seguridad_doble_factor_activa),
    clabe_transferencias: safeText(capa.clabe_transferencias),
    banco_transferencias: safeText(capa.banco_transferencias),
    beneficiario_transferencias: safeText(capa.beneficiario_transferencias),
    referencia_transferencia_prefijo: safeText(
      capa.referencia_transferencia_prefijo,
      "BETT"
    ),
    plazo_meses_default: String(capa.plazo_meses_default || 12),
    periodicidad_cobro_default: safeText(
      capa.periodicidad_cobro_default,
      "MENSUAL"
    ),
    fecha_vencimiento_modo: safeText(
      capa.fecha_vencimiento_modo,
      capa.dia_vencimiento_default ? "GLOBAL" : "PENDIENTE"
    ),
    dia_vencimiento_default:
      capa.dia_vencimiento_default !== null &&
      capa.dia_vencimiento_default !== undefined
        ? String(capa.dia_vencimiento_default)
        : "",
    dias_gracia_default: String(capa.dias_gracia_default || 0),
    auto_renueva_default: Boolean(capa.auto_renueva_default),
    aplicacion_pagos: safeText(capa.aplicacion_pagos, "ADEUDO_MAS_ANTIGUO"),
    activo: capa.activo ?? true,
  };
}

function buildPayloadFromForm(form: CapaFormState) {
  const parsedDueDay = parseOptionalInteger(form.dia_vencimiento_default);
  const dueMode =
    form.fecha_vencimiento_modo === "INDIVIDUAL"
      ? "INDIVIDUAL"
      : parsedDueDay
        ? "GLOBAL"
        : "PENDIENTE";

  return {
    ...form,
    nombre: safeText(form.nombre).trim(),
    nombre_administrador: safeText(form.nombre_administrador).trim(),
    es_persona_moral: form.es_persona_moral,
    razon_social: safeText(form.razon_social).trim(),
    rfc: safeText(form.rfc).trim().toUpperCase(),
    regimen_fiscal:
      normalizeOperationalFiscalRegimeValue(
        form.regimen_fiscal,
        form.es_persona_moral
      ) ||
      safeText(form.regimen_fiscal).trim(),
    correo_contacto: safeText(form.correo_contacto).trim(),
    telefono_contacto: safeText(form.telefono_contacto).trim(),
    logo_url: safeText(form.logo_url).trim(),
    pais_fiscal: safeText(form.pais_fiscal).trim() || "Mexico",
    codigo_postal_fiscal: safeText(form.codigo_postal_fiscal).trim(),
    estado_fiscal: safeText(form.estado_fiscal).trim(),
    municipio_fiscal: safeText(form.municipio_fiscal).trim(),
    colonia_fiscal: safeText(form.colonia_fiscal).trim(),
    calle_fiscal: safeText(form.calle_fiscal).trim(),
    numero_exterior_fiscal: safeText(form.numero_exterior_fiscal).trim(),
    numero_interior_fiscal: safeText(form.numero_interior_fiscal).trim(),
    facturacion_serie_ingresos:
      safeText(form.facturacion_serie_ingresos).trim().toUpperCase() || "A",
    facturacion_lugar_expedicion: safeText(
      form.facturacion_lugar_expedicion
    ).trim(),
    facturacion_producto_servicio: safeText(
      form.facturacion_producto_servicio
    ).trim(),
    facturacion_unidad:
      safeText(form.facturacion_unidad).trim().toUpperCase() || "E48",
    facturacion_uso_cfdi_default:
      safeText(form.facturacion_uso_cfdi_default).trim().toUpperCase() ||
      "G03",
    facturacion_metodo_pago_default:
      safeText(form.facturacion_metodo_pago_default).trim().toUpperCase() ||
      "PUE",
    facturacion_forma_pago_default:
      safeText(form.facturacion_forma_pago_default).trim() || "03",
    portal_clientes_url_base: safeText(form.portal_clientes_url_base).trim(),
    seguridad_doble_factor_activa: form.seguridad_doble_factor_activa,
    clabe_transferencias: safeText(form.clabe_transferencias).replace(/\D/g, ""),
    banco_transferencias: safeText(form.banco_transferencias).trim(),
    beneficiario_transferencias: safeText(
      form.beneficiario_transferencias
    ).trim(),
    referencia_transferencia_prefijo:
      safeText(form.referencia_transferencia_prefijo).trim().toUpperCase() ||
      "BETT",
    plazo_meses_default: Math.max(
      parseOptionalInteger(form.plazo_meses_default) ?? 12,
      1
    ),
    fecha_vencimiento_modo: dueMode,
    dia_vencimiento_default: dueMode === "GLOBAL" ? parsedDueDay : null,
    dias_gracia_default: Math.max(
      parseOptionalInteger(form.dias_gracia_default) ?? 0,
      0
    ),
  };
}

function inputClassName(extra = "") {
  return `w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-400/50 ${extra}`;
}

const fieldLabelClassName =
  "block min-h-[2.5rem] text-[11px] uppercase leading-5 tracking-[0.18em] text-zinc-500";

function InfoButton({
  info,
  onInfo,
}: {
  info: FieldInfo;
  onInfo?: (info: FieldInfo) => void;
}) {
  return (
    <button
      type="button"
      title={info.title}
      aria-label={`Informacion: ${info.title}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onInfo?.(info);
      }}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-cyan-500/25 bg-cyan-500/10 text-[11px] font-semibold normal-case tracking-normal text-cyan-100 transition hover:border-cyan-400/60 hover:bg-cyan-500/20"
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
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-field-info-title"
        className="w-full max-w-lg rounded-[28px] border border-cyan-500/20 bg-zinc-950 p-5 shadow-2xl shadow-black/60"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">
              Detalle del campo
            </p>
            <h3
              id="onboarding-field-info-title"
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
              <li key={detail} className="rounded-2xl border border-white/8 bg-zinc-900/70 px-4 py-3">
                {detail}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  min,
  max,
  maxLength,
  step,
  inputMode,
  pattern,
  required = false,
  helper,
  error,
  info,
  onInfo,
  numericOnly = false,
  decimalOnly = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  step?: string;
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search";
  pattern?: string;
  required?: boolean;
  helper?: string;
  error?: string;
  info?: FieldInfo;
  onInfo?: (info: FieldInfo) => void;
  numericOnly?: boolean;
  decimalOnly?: boolean;
}) {
  const helperId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-helper`;
  const inputPattern = numericOnly
    ? "[0-9]*"
    : decimalOnly
      ? "[0-9]+([.][0-9]{0,2})?"
      : pattern;
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    if (numericOnly) {
      onChange(sanitizeIntegerInput(nextValue, maxLength));
      return;
    }
    if (decimalOnly) {
      onChange(sanitizeMoneyInput(nextValue));
      return;
    }
    onChange(nextValue);
  };

  return (
    <label className="block">
      <span className={fieldLabelClassName}>
        <span className="inline-flex items-center gap-2">
          <span>{label}</span>
          {required ? (
            <span className="text-cyan-200">Obligatorio</span>
          ) : null}
          {info ? <InfoButton info={info} onInfo={onInfo} /> : null}
        </span>
      </span>
      <input
        type={type}
        value={value}
        min={min}
        max={max}
        maxLength={maxLength}
        step={step}
        inputMode={inputMode}
        pattern={inputPattern}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={helper || error ? helperId : undefined}
        placeholder={placeholder}
        onChange={handleInputChange}
        className={`mt-2 ${inputClassName(error ? "border-rose-500/60 focus:border-rose-400/70" : "")}`}
      />
      {error || helper ? (
        <span
          id={helperId}
          className={`mt-2 block text-xs leading-5 ${
            error ? "text-rose-200" : "text-zinc-500"
          }`}
        >
          {error || helper}
        </span>
      ) : null}
    </label>
  );
}

function MonthPeriodPicker({
  label,
  value,
  onChange,
  required = false,
  helper,
  error,
  info,
  onInfo,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  helper?: string;
  error?: string;
  info?: FieldInfo;
  onInfo?: (info: FieldInfo) => void;
}) {
  const helperId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-helper`;
  const { year, month } = parseMonthPeriod(value);
  const selectedMonth = MONTH_PICKER_OPTIONS.find((item) => item.value === month);
  const selectMonth = (nextYear: number, nextMonth: string) => {
    onChange(`${nextYear}-${nextMonth}`);
  };

  return (
    <div className="block">
      <span className={fieldLabelClassName}>
        <span className="inline-flex items-center gap-2">
          <span>{label}</span>
          {required ? (
            <span className="text-cyan-200">Obligatorio</span>
          ) : null}
          {info ? <InfoButton info={info} onInfo={onInfo} /> : null}
        </span>
      </span>
      <div
        aria-invalid={Boolean(error)}
        aria-describedby={helper || error ? helperId : undefined}
        className={`mt-2 rounded-2xl border bg-zinc-950/80 p-3 ${
          error ? "border-rose-500/60" : "border-white/10"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Periodo seleccionado
            </p>
            <p className="mt-1 text-base font-semibold text-white">
              {selectedMonth?.label || "Mes"} {year}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => selectMonth(year - 1, month)}
              className="h-9 rounded-xl border border-white/10 bg-zinc-900 px-3 text-sm text-zinc-200 transition hover:border-cyan-400/50"
              aria-label="Anio anterior"
            >
              {year - 1}
            </button>
            <span
              aria-current="date"
              aria-label={`Anio seleccionado ${year}`}
              className="inline-flex h-9 min-w-24 items-center justify-center rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-3 text-sm font-semibold text-cyan-100"
            >
              {year}
            </span>
            <button
              type="button"
              onClick={() => selectMonth(year + 1, month)}
              className="h-9 rounded-xl border border-white/10 bg-zinc-900 px-3 text-sm text-zinc-200 transition hover:border-cyan-400/50"
              aria-label="Anio siguiente"
            >
              {year + 1}
            </button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {MONTH_PICKER_OPTIONS.map((item) => {
            const selected = item.value === month;
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={selected}
                onClick={() => selectMonth(year, item.value)}
                className={`h-11 rounded-xl border px-2 text-sm font-medium transition ${
                  selected
                    ? "border-cyan-400/70 bg-cyan-400 text-zinc-950"
                    : "border-white/10 bg-zinc-900/70 text-zinc-300 hover:border-cyan-400/50 hover:text-white"
                }`}
              >
                {item.short}
              </button>
            );
          })}
        </div>
      </div>
      {error || helper ? (
        <span
          id={helperId}
          className={`mt-2 block text-xs leading-5 ${
            error ? "text-rose-200" : "text-zinc-500"
          }`}
        >
          {error || helper}
        </span>
      ) : null}
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  maxLength,
  helper,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  helper?: string;
  error?: string;
}) {
  const helperId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-helper`;
  return (
    <label className="block">
      <span className={fieldLabelClassName}>
        {label}
        {required ? (
          <span className="ml-2 text-cyan-200">Obligatorio</span>
        ) : null}
      </span>
      <textarea
        value={value}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        aria-invalid={Boolean(error)}
        aria-describedby={helper || error ? helperId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-2 min-h-24 resize-y ${inputClassName(
          error ? "border-rose-500/60 focus:border-rose-400/70" : ""
        )}`}
      />
      {error || helper ? (
        <span
          id={helperId}
          className={`mt-2 block text-xs leading-5 ${
            error ? "text-rose-200" : "text-zinc-500"
          }`}
        >
          {error || helper}
        </span>
      ) : null}
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  required = false,
  disabled = false,
  helper,
  error,
  info,
  onInfo,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  helper?: string;
  error?: string;
  info?: FieldInfo;
  onInfo?: (info: FieldInfo) => void;
}) {
  const helperId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-helper`;
  return (
    <label className="block">
      <span className={fieldLabelClassName}>
        <span className="inline-flex items-center gap-2">
          <span>{label}</span>
          {required ? (
            <span className="text-cyan-200">Obligatorio</span>
          ) : null}
          {info ? <InfoButton info={info} onInfo={onInfo} /> : null}
        </span>
      </span>
      <select
        value={value}
        required={required}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={helper || error ? helperId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-2 ${inputClassName(
          `${error ? "border-rose-500/60 focus:border-rose-400/70" : ""} ${
            disabled ? "cursor-not-allowed opacity-60" : ""
          }`
        )}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error || helper ? (
        <span
          id={helperId}
          className={`mt-2 block text-xs leading-5 ${
            error ? "text-rose-200" : "text-zinc-500"
          }`}
        >
          {error || helper}
        </span>
      ) : null}
    </label>
  );
}

function CheckboxField({
  label,
  helper,
  checked,
  onChange,
  info,
  onInfo,
}: {
  label: string;
  helper?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  info?: FieldInfo;
  onInfo?: (info: FieldInfo) => void;
}) {
  return (
    <label className="flex gap-3 rounded-2xl border border-white/8 bg-zinc-950/70 p-4 text-sm text-zinc-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-cyan-400"
      />
      <span>
        <span className="flex items-center gap-2 font-medium text-white">
          <span>{label}</span>
          {info ? <InfoButton info={info} onInfo={onInfo} /> : null}
        </span>
        {helper ? (
          <span className="mt-1 block text-xs leading-5 text-zinc-500">
            {helper}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function BusinessRuleFormFields({
  form,
  errors,
  ruleCatalogs,
  onUpdate,
  onInfo,
}: {
  form: RuleFormState;
  errors: Partial<Record<keyof RuleFormState, string>>;
  ruleCatalogs: RuleCatalogs;
  onUpdate: (patch: Partial<RuleFormState>) => void;
  onInfo: (info: FieldInfo) => void;
}) {
  const valueLabel = ruleValueFieldLabel(form.tipo_calculo);

  return (
    <div className="mt-5 grid gap-3 md:grid-cols-2">
      <FormField
        label="Nombre"
        value={form.nombre}
        onChange={(nombre) => onUpdate({ nombre })}
        placeholder="Ej. Interes moratorio"
        required
        maxLength={80}
        error={errors.nombre}
        info={RULE_FORM_FIELD_INFO.nombre}
        onInfo={onInfo}
      />
      <SelectField
        label="Tipo de calculo"
        value={form.tipo_calculo}
        options={ruleCatalogs.tipos_calculo}
        onChange={(tipo_calculo) => onUpdate({ tipo_calculo })}
        required
        info={RULES_FIELD_INFO.tipoCalculo}
        onInfo={onInfo}
      />
      <FormField
        label={valueLabel}
        type="text"
        inputMode="decimal"
        min={0.01}
        step="0.01"
        decimalOnly
        value={form.valor}
        onChange={(valor) => onUpdate({ valor: sanitizeMoneyInput(valor) })}
        placeholder={isPercentageRuleType(form.tipo_calculo) ? "Ej. 5" : "Ej. 150.00"}
        required
        helper={businessRuleValueHelper(form.tipo_calculo)}
        error={errors.valor}
        info={RULES_FIELD_INFO.valorRegla}
        onInfo={onInfo}
      />
      <SelectField
        label="Periodicidad"
        value={form.periodicidad}
        options={ruleCatalogs.periodicidades}
        onChange={(periodicidad) => onUpdate({ periodicidad })}
        required
        info={RULE_FORM_FIELD_INFO.periodicidad}
        onInfo={onInfo}
      />
      <FormField
        label="Dias condicion"
        type="text"
        inputMode="numeric"
        min={0}
        max={365}
        maxLength={3}
        numericOnly
        value={form.dias_condicion}
        onChange={(dias_condicion) =>
          onUpdate({ dias_condicion: sanitizeIntegerInput(dias_condicion, 3) })
        }
        placeholder="Ej. 10"
        helper="Opcional. Solo numeros enteros de 0 a 365."
        error={errors.dias_condicion}
        info={RULES_FIELD_INFO.diasCondicion}
        onInfo={onInfo}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <CheckboxField
          label="Aplica a todos"
          checked={form.aplica_a_todos}
          onChange={(aplica_a_todos) => onUpdate({ aplica_a_todos })}
          info={RULE_FORM_FIELD_INFO.aplicaATodos}
          onInfo={onInfo}
        />
        <CheckboxField
          label="Regla activa"
          checked={form.activo}
          onChange={(activo) => onUpdate({ activo })}
          info={RULE_FORM_FIELD_INFO.reglaActiva}
          onInfo={onInfo}
        />
      </div>
    </div>
  );
}

function CxpProgramFormFields({
  form,
  errors,
  entities,
  onUpdate,
  onInfo,
}: {
  form: CxpProgramFormState;
  errors: Partial<Record<keyof CxpProgramFormState, string>>;
  entities: OnboardingEntityOption[];
  onUpdate: (patch: Partial<CxpProgramFormState>) => void;
  onInfo: (info: FieldInfo) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(
      form.fecha_fin ||
        form.banco_pago ||
        form.cuenta_pago ||
        form.clabe_pago ||
        form.prorrateable ||
        form.observaciones
    )
  );

  return (
    <div className="mt-5 space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <SelectField
          label="Unidad / edificio"
          value={form.entidad_id}
          options={[
            { value: "", label: "Selecciona unidad" },
            ...entities.map((entity) => ({
              value: String(entity.id),
              label: entity.ciudad
                ? `${entity.nombre} - ${entity.ciudad}`
                : entity.nombre,
            })),
          ]}
          onChange={(entidad_id) => onUpdate({ entidad_id })}
          required
          disabled={Boolean(form.id)}
          helper={
            form.id
              ? "La unidad no se cambia al editar; crea una nueva CxP si debe vivir en otra unidad."
              : "Selecciona donde se aplicara este gasto."
          }
          error={errors.entidad_id}
          info={CXP_FIELD_INFO.unidad}
          onInfo={onInfo}
        />
        <FormField
          label="Nombre"
          value={form.nombre}
          onChange={(nombre) => onUpdate({ nombre })}
          placeholder="Ej. Luz edificio A"
          required
          maxLength={100}
          error={errors.nombre}
          info={CXP_FIELD_INFO.nombrePrograma}
          onInfo={onInfo}
        />
        <FormField
          label="Proveedor"
          value={form.proveedor_nombre}
          onChange={(proveedor_nombre) => onUpdate({ proveedor_nombre })}
          placeholder="Ej. CFE"
          required
          maxLength={120}
          error={errors.proveedor_nombre}
          info={CXP_FIELD_INFO.proveedor}
          onInfo={onInfo}
        />
        <FormField
          label="Monto base"
          type="text"
          inputMode="decimal"
          min={1}
          step="0.01"
          decimalOnly
          value={form.monto_base}
          onChange={(monto_base) =>
            onUpdate({ monto_base: sanitizeMoneyInput(monto_base) })
          }
          placeholder="Ej. 1500.00"
          required
          helper="Para montos variables, usa un estimado y ajusta el importe real cuando llegue el recibo."
          error={errors.monto_base}
          info={CXP_FIELD_INFO.montoBase}
          onInfo={onInfo}
        />
        <SelectField
          label="Periodicidad"
          value={form.periodicidad}
          options={PERIODICIDADES}
          onChange={(periodicidad) => onUpdate({ periodicidad })}
          required
          error={errors.periodicidad}
          info={CXP_FIELD_INFO.periodicidad}
          onInfo={onInfo}
        />
        <FormField
          label="Dia de vencimiento"
          type="text"
          inputMode="numeric"
          min={1}
          max={31}
          maxLength={2}
          numericOnly
          value={form.dia_vencimiento}
          onChange={(dia_vencimiento) =>
            onUpdate({ dia_vencimiento: sanitizeIntegerInput(dia_vencimiento, 2) })
          }
          placeholder="Ej. 15"
          required
          helper="Solo numeros enteros del 1 al 31."
          error={errors.dia_vencimiento}
          info={CXP_FIELD_INFO.diaVencimiento}
          onInfo={onInfo}
        />
        <FormField
          label="Dias de gracia"
          type="text"
          inputMode="numeric"
          min={0}
          max={365}
          maxLength={3}
          numericOnly
          value={form.dias_gracia}
          onChange={(dias_gracia) =>
            onUpdate({ dias_gracia: sanitizeIntegerInput(dias_gracia, 3) })
          }
          required
          helper="Solo numeros enteros de 0 a 365."
          error={errors.dias_gracia}
        />
        <SelectField
          label="Categoria"
          value={form.categoria}
          options={CXP_CATEGORY_OPTIONS}
          onChange={(categoria) => onUpdate({ categoria })}
          required
          error={errors.categoria}
          info={CXP_FIELD_INFO.categoria}
          onInfo={onInfo}
        />
        <SelectField
          label="Prioridad"
          value={form.prioridad}
          options={CXP_PRIORITY_OPTIONS}
          onChange={(prioridad) => onUpdate({ prioridad })}
          required
          error={errors.prioridad}
          info={CXP_FIELD_INFO.prioridad}
          onInfo={onInfo}
        />
        <div className="grid gap-2 sm:grid-cols-2 md:col-span-2">
          <CheckboxField
            label="Activo"
            helper="Si esta inactivo, se conserva como referencia sin operar."
            checked={form.activo}
            onChange={(activo) => onUpdate({ activo })}
            info={CXP_FIELD_INFO.activo}
            onInfo={onInfo}
          />
          <CheckboxField
            label="Genera recargo"
            helper="Marca esto si el proveedor penaliza atrasos."
            checked={form.genera_recargo}
            onChange={(genera_recargo) => onUpdate({ genera_recargo })}
            info={CXP_FIELD_INFO.recargo}
            onInfo={onInfo}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-white/8 bg-zinc-950/60">
        <button
          type="button"
          onClick={() => setAdvancedOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span>
            <span className="block text-[11px] uppercase tracking-[0.22em] text-zinc-500">
              Opciones avanzadas
            </span>
            <span className="mt-1 block text-sm text-zinc-400">
              Vigencia, datos bancarios, prorrateo y notas. Si no cambias nada,
              la CxP inicia en el mes actual y queda sin fecha fin.
            </span>
          </span>
          <span className="rounded-full border border-white/10 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
            {advancedOpen ? "Ocultar" : "Mostrar"}
          </span>
        </button>

        {advancedOpen ? (
          <div className="grid gap-3 border-t border-white/8 p-4 md:grid-cols-2">
            <SelectField
              label="Naturaleza"
              value={form.naturaleza}
              options={CXP_NATURE_OPTIONS}
              onChange={(naturaleza) => onUpdate({ naturaleza })}
              required
              error={errors.naturaleza}
              info={CXP_FIELD_INFO.naturaleza}
              onInfo={onInfo}
            />
            <FormField
              label="Fecha inicio"
              type="date"
              value={form.fecha_inicio}
              onChange={(fecha_inicio) => onUpdate({ fecha_inicio })}
              required
              helper="Por default inicia el primer dia del mes actual."
              error={errors.fecha_inicio}
            />
            <FormField
              label="Fecha fin"
              type="date"
              value={form.fecha_fin}
              onChange={(fecha_fin) => onUpdate({ fecha_fin })}
              helper="Opcional. Dejalo vacio para mantenerlo recurrente."
              error={errors.fecha_fin}
            />
            <FormField
              label="Banco pago"
              value={form.banco_pago}
              onChange={(banco_pago) => onUpdate({ banco_pago })}
              maxLength={80}
              helper="Opcional. Banco o medio de pago del proveedor."
              error={errors.banco_pago}
            />
            <FormField
              label="Cuenta pago"
              value={form.cuenta_pago}
              onChange={(cuenta_pago) => onUpdate({ cuenta_pago })}
              maxLength={40}
              helper="Opcional. Cuenta, convenio o referencia operativa."
              error={errors.cuenta_pago}
            />
            <FormField
              label="CLABE pago"
              type="text"
              inputMode="numeric"
              maxLength={18}
              numericOnly
              value={form.clabe_pago}
              onChange={(clabe_pago) =>
                onUpdate({ clabe_pago: sanitizeIntegerInput(clabe_pago, 18) })
              }
              helper="Opcional. Si la capturas, debe tener 18 digitos."
              error={errors.clabe_pago}
            />
            <CheckboxField
              label="Prorrateable"
              helper="Usalo cuando el gasto pueda distribuirse por dias."
              checked={form.prorrateable}
              onChange={(prorrateable) => onUpdate({ prorrateable })}
            />
            <div className="md:col-span-2">
              <TextAreaField
                label="Notas operativas"
                value={form.observaciones}
                onChange={(observaciones) => onUpdate({ observaciones })}
                maxLength={600}
                error={errors.observaciones}
                helper="Opcional. Maximo 600 caracteres."
                placeholder="Ej. cuenta, referencia, contacto o criterio de pago."
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CxpPresetWizardModal({
  preset,
  form,
  index,
  total,
  entities,
  saving,
  error,
  onUpdate,
  onClose,
  onSave,
}: {
  preset: (typeof CXP_FIXED_PAYMENT_PRESETS)[number];
  form: CxpProgramFormState;
  index: number;
  total: number;
  entities: OnboardingEntityOption[];
  saving: boolean;
  error: string;
  onUpdate: (patch: Partial<CxpProgramFormState>) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [fieldInfo, setFieldInfo] = useState<FieldInfo | null>(null);
  const errors = validateCxpProgramForm(form);
  const isLast = index >= total - 1;

  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <FieldInfoModal info={fieldInfo} onClose={() => setFieldInfo(null)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cxp-preset-wizard-title"
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[30px] border border-cyan-500/20 bg-zinc-950 p-5 shadow-2xl shadow-black/60"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">
              CxP seleccionada {index + 1} de {total}
            </p>
            <h3
              id="cxp-preset-wizard-title"
              className="mt-2 text-2xl font-semibold text-white"
            >
              {preset.label}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Completa los datos de esta cuenta por pagar. Al guardar, BetterP
              abrira la siguiente CxP seleccionada.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-white/8 bg-zinc-900/70 p-4">
          <p className="text-xs leading-5 text-zinc-400">
            Proveedor sugerido: {preset.proveedor}. Referencias MX:{" "}
            {preset.proveedoresMx}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-400">
            <span className="rounded-full border border-white/8 bg-zinc-950 px-2 py-1">
              {preset.categoria}
            </span>
            <span className="rounded-full border border-white/8 bg-zinc-950 px-2 py-1">
              {preset.prioridad}
            </span>
            <span className="rounded-full border border-white/8 bg-zinc-950 px-2 py-1">
              {preset.naturaleza}
            </span>
          </div>
        </div>

        <CxpProgramFormFields
          form={form}
          errors={errors}
          entities={entities}
          onUpdate={onUpdate}
          onInfo={setFieldInfo}
        />

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
          <p className="text-xs leading-5 text-zinc-500">
            {isLast
              ? "Esta es la ultima CxP seleccionada."
              : "Al guardar, se abrira la siguiente CxP seleccionada."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || hasValidationErrors(errors)}
              className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving
                ? "Creando"
                : isLast
                  ? "Crear y terminar"
                  : "Crear y continuar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CxpProgramEditorModal({
  form,
  entities,
  saving,
  error,
  eyebrow,
  title,
  description,
  saveLabel,
  onUpdate,
  onClose,
  onSave,
}: {
  form: CxpProgramFormState;
  entities: OnboardingEntityOption[];
  saving: boolean;
  error: string;
  eyebrow: string;
  title: string;
  description: string;
  saveLabel: string;
  onUpdate: (patch: Partial<CxpProgramFormState>) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [fieldInfo, setFieldInfo] = useState<FieldInfo | null>(null);
  const errors = validateCxpProgramForm(form);

  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <FieldInfoModal info={fieldInfo} onClose={() => setFieldInfo(null)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cxp-program-editor-title"
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[30px] border border-cyan-500/20 bg-zinc-950 p-5 shadow-2xl shadow-black/60"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">
              {eyebrow}
            </p>
            <h3
              id="cxp-program-editor-title"
              className="mt-2 text-2xl font-semibold text-white"
            >
              {title}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              {description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>

        <CxpProgramFormFields
          form={form}
          errors={errors}
          entities={entities}
          onUpdate={onUpdate}
          onInfo={setFieldInfo}
        />

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
          <p className="text-xs leading-5 text-zinc-500">
            Si no abres opciones avanzadas, BetterP crea la CxP desde el mes actual
            y la mantiene recurrente sin fecha fin.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || hasValidationErrors(errors)}
              className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Guardando" : saveLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DueModeButton({
  active,
  title,
  copy,
  onClick,
}: {
  active: boolean;
  title: string;
  copy: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition ${
        active
          ? "border-cyan-400/40 bg-cyan-500/10 text-white"
          : "border-white/8 bg-zinc-950/70 text-zinc-300 hover:border-zinc-700"
      }`}
    >
      <span className="block font-semibold">{title}</span>
      <span className="mt-1 block text-sm leading-5 text-zinc-500">{copy}</span>
    </button>
  );
}

function SuggestedRuleWizardModal({
  rule,
  form,
  index,
  total,
  saving,
  error,
  ruleCatalogs,
  onUpdate,
  onClose,
  onSave,
}: {
  rule: SuggestedRule;
  form: RuleFormState;
  index: number;
  total: number;
  saving: boolean;
  error: string;
  ruleCatalogs: RuleCatalogs;
  onUpdate: (patch: Partial<RuleFormState>) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [fieldInfo, setFieldInfo] = useState<FieldInfo | null>(null);
  const errors = validateBusinessRuleForm(form);
  const isLast = index >= total - 1;

  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <FieldInfoModal info={fieldInfo} onClose={() => setFieldInfo(null)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="suggested-rule-wizard-title"
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[30px] border border-cyan-500/20 bg-zinc-950 p-5 shadow-2xl shadow-black/60"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">
              Regla seleccionada {index + 1} de {total}
            </p>
            <h3
              id="suggested-rule-wizard-title"
              className="mt-2 text-2xl font-semibold text-white"
            >
              {rule.nombre}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Revisa y completa la plantilla antes de crearla. Al guardar, BetterP
              pasara automaticamente a la siguiente regla seleccionada.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-white/8 bg-zinc-900/70 p-4">
          <p className="text-xs leading-5 text-zinc-400">{rule.descripcion}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-400">
            <span className="rounded-full border border-white/8 bg-zinc-950 px-2 py-1">
              {rule.tipo_calculo_label || rule.tipo_calculo}
            </span>
            <span className="rounded-full border border-white/8 bg-zinc-950 px-2 py-1">
              {ruleValueLabel(rule)}
            </span>
            <span className="rounded-full border border-white/8 bg-zinc-950 px-2 py-1">
              {rule.periodicidad_label || rule.periodicidad}
            </span>
          </div>
        </div>

        <BusinessRuleFormFields
          form={form}
          errors={errors}
          ruleCatalogs={ruleCatalogs}
          onUpdate={onUpdate}
          onInfo={setFieldInfo}
        />

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
          <p className="text-xs leading-5 text-zinc-500">
            {isLast
              ? "Esta es la ultima regla seleccionada."
              : "Al guardar, se abrira la siguiente regla seleccionada."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || hasValidationErrors(errors)}
              className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving
                ? "Creando"
                : isLast
                  ? "Crear y terminar"
                  : "Crear y continuar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BusinessRuleEditorModal({
  form,
  saving,
  error,
  ruleCatalogs,
  onUpdate,
  onClose,
  onSave,
}: {
  form: RuleFormState;
  saving: boolean;
  error: string;
  ruleCatalogs: RuleCatalogs;
  onUpdate: (patch: Partial<RuleFormState>) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [fieldInfo, setFieldInfo] = useState<FieldInfo | null>(null);
  const errors = validateBusinessRuleForm(form);
  const isEditing = Boolean(form.id);

  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <FieldInfoModal info={fieldInfo} onClose={() => setFieldInfo(null)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="business-rule-editor-title"
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[30px] border border-cyan-500/20 bg-zinc-950 p-5 shadow-2xl shadow-black/60"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">
              {isEditing ? "Editar regla heredable" : "Nueva regla heredable"}
            </p>
            <h3
              id="business-rule-editor-title"
              className="mt-2 text-2xl font-semibold text-white"
            >
              {isEditing ? form.nombre || "Ajustar regla" : "Crear regla personalizada"}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Define la regla que se heredara a nuevas unidades. Los montos y
              porcentajes deben ser mayores a cero; los dias solo aceptan enteros.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>

        <BusinessRuleFormFields
          form={form}
          errors={errors}
          ruleCatalogs={ruleCatalogs}
          onUpdate={onUpdate}
          onInfo={setFieldInfo}
        />

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
          <p className="text-xs leading-5 text-zinc-500">
            {isEditing
              ? "Al guardar, se actualiza la regla heredable de la capa."
              : "Al crearla, quedara disponible para nuevas unidades y ocupaciones."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || hasValidationErrors(errors)}
              className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Guardando" : isEditing ? "Guardar cambios" : "Crear regla"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
      <div
        className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-emerald-300 to-lime-300 transition-all"
        style={{ width: `${Math.max(0, Math.min(value, 100))}%` }}
      />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="h-44 animate-pulse rounded-[32px] border border-white/8 bg-zinc-950/70" />
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-36 animate-pulse rounded-[28px] border border-white/8 bg-zinc-950/70"
          />
        ))}
      </div>
    </div>
  );
}

function BatchImportLoadingOverlay() {
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[30px] border border-cyan-500/25 bg-zinc-950 p-6 text-center shadow-2xl shadow-black/60">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
        <p className="mt-5 text-[11px] uppercase tracking-[0.26em] text-cyan-200">
          Migracion en proceso
        </p>
        <h3 className="mt-2 text-2xl font-semibold text-white">
          Procesando archivo
        </h3>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Espera a que BetterP termine de validar e importar la carga. La pantalla
          se liberara cuando el backend responda.
        </p>
      </div>
    </div>
  );
}

function OnboardingStepEditor({
  step,
  capaForm,
  dueMode,
  businessRules,
  suggestedRules,
  ruleCatalogs,
  ruleForm,
  savingBusinessRule,
  deletingRuleId,
  flushTop = false,
  showInlineCapaSaveAction = true,
  rulesTab: controlledRulesTab,
  cxpTab: controlledCxpTab,
  onRulesTabChange,
  onCxpTabChange,
  updateCapaForm,
  updateRuleForm,
  onDueModeChange,
  loadingCapa,
  savingCapa,
  batchFile,
  importingBatch,
  batchMessage,
  batchErrorReport,
  cxpEntities,
  cxpPrograms,
  cxpEntityId,
  cxpSelectedPresetKeys,
  cxpPresetAmounts,
  cxpBatchFile,
  cxpBatchPeriod,
  cxpBatchMessage,
  importingCxpBatch,
  cxpProgramForm,
  savingCxpProgram,
  deletingCxpProgramId,
  suggestedPendingCount,
  onSaveCapa,
  onDownloadBatchTemplate,
  onBatchFileChange,
  onImportBatch,
  onDownloadBatchErrorReport,
  onCxpEntityChange,
  onToggleCxpPreset,
  onCxpPresetAmountChange,
  onDownloadCxpBatchTemplate,
  onCxpBatchFileChange,
  onCxpBatchPeriodChange,
  onImportCxpBatch,
  onUpdateCxpProgramForm,
  onCreateCxpProgramFromForm,
  onEditCxpProgram,
  onCancelCxpProgramEdit,
  onSaveCxpProgram,
  onRequestDeleteCxpProgram,
  onCreateBusinessRuleFromForm,
  onSaveBusinessRule,
  onEditBusinessRule,
  onCancelBusinessRuleEdit,
  onRequestDeleteBusinessRule,
  onRefresh,
}: {
  step: OnboardingStep;
  capaForm: CapaFormState;
  dueMode: GlobalDueMode;
  businessRules: BusinessRule[];
  suggestedRules: SuggestedRule[];
  ruleCatalogs: RuleCatalogs;
  ruleForm: RuleFormState;
  savingBusinessRule: boolean;
  deletingRuleId: number | null;
  flushTop?: boolean;
  showInlineCapaSaveAction?: boolean;
  rulesTab?: RulesOnboardingTab;
  cxpTab?: CxpOnboardingTab;
  onRulesTabChange?: (tab: RulesOnboardingTab) => void;
  onCxpTabChange?: (tab: CxpOnboardingTab) => void;
  updateCapaForm: (patch: Partial<CapaFormState>) => void;
  updateRuleForm: (patch: Partial<RuleFormState>) => void;
  onDueModeChange: (mode: GlobalDueMode) => void;
  loadingCapa: boolean;
  savingCapa: boolean;
  batchFile: File | null;
  importingBatch: boolean;
  batchMessage: string;
  batchErrorReport: BatchErrorReport | null;
  cxpEntities: OnboardingEntityOption[];
  cxpPrograms: OnboardingCxpProgram[];
  cxpEntityId: string;
  cxpSelectedPresetKeys: string[];
  cxpPresetAmounts: Record<string, string>;
  cxpBatchFile: File | null;
  cxpBatchPeriod: string;
  cxpBatchMessage: string;
  importingCxpBatch: boolean;
  cxpProgramForm: CxpProgramFormState;
  savingCxpProgram: boolean;
  deletingCxpProgramId: number | null;
  suggestedPendingCount: number;
  onSaveCapa: (label: string) => void;
  onDownloadBatchTemplate: () => void;
  onBatchFileChange: (file: File | null) => void;
  onImportBatch: () => void;
  onDownloadBatchErrorReport: () => void;
  onCxpEntityChange: (value: string) => void;
  onToggleCxpPreset: (key: string) => void;
  onCxpPresetAmountChange: (key: string, value: string) => void;
  onDownloadCxpBatchTemplate: () => void;
  onCxpBatchFileChange: (file: File | null) => void;
  onCxpBatchPeriodChange: (value: string) => void;
  onImportCxpBatch: () => void;
  onUpdateCxpProgramForm: (patch: Partial<CxpProgramFormState>) => void;
  onCreateCxpProgramFromForm: (
    form: CxpProgramFormState
  ) => Promise<CxpProgramSaveResult>;
  onEditCxpProgram: (program: OnboardingCxpProgram) => void;
  onCancelCxpProgramEdit: () => void;
  onSaveCxpProgram: () => Promise<CxpProgramSaveResult>;
  onRequestDeleteCxpProgram: (program: OnboardingCxpProgram) => void;
  onCreateBusinessRuleFromForm: (form: RuleFormState) => Promise<RuleSaveResult>;
  onSaveBusinessRule: () => Promise<RuleSaveResult>;
  onEditBusinessRule: (rule: BusinessRule) => void;
  onCancelBusinessRuleEdit: () => void;
  onRequestDeleteBusinessRule: (rule: BusinessRule) => void;
  onRefresh: () => void;
}) {
  const [localRulesTab, setLocalRulesTab] = useState<RulesOnboardingTab>("cobro");
  const [localCxpTab, setLocalCxpTab] = useState<CxpOnboardingTab>("manual");
  const [fieldInfo, setFieldInfo] = useState<FieldInfo | null>(null);
  const [selectedSuggestedRuleNames, setSelectedSuggestedRuleNames] = useState<string[]>([]);
  const [ruleEditorModalOpen, setRuleEditorModalOpen] = useState(false);
  const [ruleEditorError, setRuleEditorError] = useState("");
  const [cxpEditorModalOpen, setCxpEditorModalOpen] = useState(false);
  const [cxpEditorError, setCxpEditorError] = useState("");
  const [suggestedRuleWizard, setSuggestedRuleWizard] = useState<{
    rules: SuggestedRule[];
    index: number;
    form: RuleFormState;
    error: string;
    saving: boolean;
  } | null>(null);
  const [cxpPresetWizard, setCxpPresetWizard] = useState<{
    presets: typeof CXP_FIXED_PAYMENT_PRESETS;
    index: number;
    form: CxpProgramFormState;
    error: string;
    saving: boolean;
  } | null>(null);
  const saveLabel = savingCapa ? "Guardando" : "Guardar cambios";
  const rulesTab = controlledRulesTab ?? localRulesTab;
  const cxpTab = controlledCxpTab ?? localCxpTab;
  const changeRulesTab = (tab: RulesOnboardingTab) => {
    setLocalRulesTab(tab);
    onRulesTabChange?.(tab);
  };
  const changeCxpTab = (tab: CxpOnboardingTab) => {
    setLocalCxpTab(tab);
    onCxpTabChange?.(tab);
  };
  const editorShellClass = `${
    flushTop ? "" : "mt-6 "
  }rounded-[26px] border border-cyan-500/15 bg-cyan-500/5 p-5`;
  const fiscalRegimeOptions = [
    { value: "", label: "Selecciona regimen fiscal" },
    ...getOperationalFiscalRegimeOptions(capaForm.es_persona_moral),
  ];
  const clabeValidation = validateClabe(capaForm.clabe_transferencias);
  const detectedBank = getBankFromClabe(capaForm.clabe_transferencias);
  const businessDataErrors = validateBusinessDataForm(capaForm);
  const rulesErrors = validateRulesForm(capaForm, dueMode);
  const portalBillingErrors = validatePortalBillingForm(capaForm);
  const selectableSuggestedRules = useMemo(
    () => suggestedRules.filter((rule) => !rule.ya_existe),
    [suggestedRules]
  );
  const selectedSuggestedRules = useMemo(
    () =>
      selectableSuggestedRules.filter((rule) =>
        selectedSuggestedRuleNames.includes(rule.nombre)
      ),
    [selectableSuggestedRules, selectedSuggestedRuleNames]
  );
  const fieldInfoModal = (
    <FieldInfoModal info={fieldInfo} onClose={() => setFieldInfo(null)} />
  );
  const loadingLabel = loadingCapa ? (
    <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
      Cargando datos editables...
    </div>
  ) : null;

  useEffect(() => {
    setSelectedSuggestedRuleNames((current) =>
      current.filter((name) =>
        selectableSuggestedRules.some((rule) => rule.nombre === name)
      )
    );
  }, [selectableSuggestedRules]);

  const toggleSuggestedRuleSelection = (name: string) => {
    setSelectedSuggestedRuleNames((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name]
    );
  };

  const openNewBusinessRuleModal = () => {
    onCancelBusinessRuleEdit();
    setRuleEditorError("");
    setRuleEditorModalOpen(true);
  };

  const openEditBusinessRuleModal = (rule: BusinessRule) => {
    onEditBusinessRule(rule);
    setRuleEditorError("");
    setRuleEditorModalOpen(true);
  };

  const closeBusinessRuleModal = () => {
    if (savingBusinessRule) {
      return;
    }
    setRuleEditorModalOpen(false);
    setRuleEditorError("");
    onCancelBusinessRuleEdit();
  };

  const saveBusinessRuleEditor = async () => {
    const validationErrors = validateBusinessRuleForm(ruleForm);
    if (hasValidationErrors(validationErrors)) {
      setRuleEditorError(
        Object.values(validationErrors).find(Boolean) ||
          "Revisa los campos de la regla."
      );
      return;
    }

    const result = await onSaveBusinessRule();
    if (result.ok) {
      setRuleEditorModalOpen(false);
      setRuleEditorError("");
      onCancelBusinessRuleEdit();
      return;
    }
    setRuleEditorError(result.error || "No se pudo guardar la regla heredable.");
  };

  const openSuggestedRuleWizard = () => {
    if (!selectedSuggestedRules.length) {
      return;
    }
    setSuggestedRuleWizard({
      rules: selectedSuggestedRules,
      index: 0,
      form: mapSuggestedRuleToForm(selectedSuggestedRules[0]),
      error: "",
      saving: false,
    });
  };

  const updateSuggestedRuleWizardForm = (patch: Partial<RuleFormState>) => {
    setSuggestedRuleWizard((current) =>
      current
        ? {
            ...current,
            form: { ...current.form, ...patch },
            error: "",
          }
        : current
    );
  };

  const saveSuggestedRuleWizardStep = async () => {
    if (!suggestedRuleWizard) {
      return;
    }
    const validationErrors = validateBusinessRuleForm(suggestedRuleWizard.form);
    if (hasValidationErrors(validationErrors)) {
      setSuggestedRuleWizard((current) =>
        current
          ? {
              ...current,
              error:
                Object.values(validationErrors).find(Boolean) ||
                "Revisa los campos de la regla.",
            }
          : current
      );
      return;
    }

    setSuggestedRuleWizard((current) =>
      current ? { ...current, saving: true, error: "" } : current
    );
    const result = await onCreateBusinessRuleFromForm({
      ...suggestedRuleWizard.form,
      id: null,
    });
    if (!result.ok) {
      setSuggestedRuleWizard((current) =>
        current
          ? {
              ...current,
              saving: false,
              error: result.error || "No se pudo crear la regla seleccionada.",
            }
          : current
      );
      return;
    }

    const nextIndex = suggestedRuleWizard.index + 1;
    if (nextIndex >= suggestedRuleWizard.rules.length) {
      setSuggestedRuleWizard(null);
      setSelectedSuggestedRuleNames([]);
      return;
    }
    const nextRule = suggestedRuleWizard.rules[nextIndex];
    setSuggestedRuleWizard({
      rules: suggestedRuleWizard.rules,
      index: nextIndex,
      form: mapSuggestedRuleToForm(nextRule),
      error: "",
      saving: false,
    });
  };

  const openNewCxpProgramModal = () => {
    onCancelCxpProgramEdit();
    onUpdateCxpProgramForm(defaultCxpProgramForm(capaForm, cxpEntityId));
    setCxpEditorError("");
    setCxpEditorModalOpen(true);
  };

  const openEditCxpProgramModal = (program: OnboardingCxpProgram) => {
    onEditCxpProgram(program);
    setCxpEditorError("");
    setCxpEditorModalOpen(true);
  };

  const closeCxpProgramModal = () => {
    if (savingCxpProgram) {
      return;
    }
    setCxpEditorModalOpen(false);
    setCxpEditorError("");
    onCancelCxpProgramEdit();
  };

  const saveCxpProgramEditor = async () => {
    const validationErrors = validateCxpProgramForm(cxpProgramForm);
    if (hasValidationErrors(validationErrors)) {
      setCxpEditorError(
        Object.values(validationErrors).find(Boolean) ||
          "Revisa los campos de la cuenta por pagar."
      );
      return;
    }

    const result = await onSaveCxpProgram();
    if (result.ok) {
      setCxpEditorModalOpen(false);
      setCxpEditorError("");
      return;
    }
    setCxpEditorError(result.error || "No se pudo guardar la cuenta por pagar.");
  };

  if (step.id === "datos_negocio") {
    return (
      <div className={editorShellClass}>
        {fieldInfoModal}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.26em] text-cyan-200">
              Captura directa
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white">
              <span className="inline-flex items-center gap-2">
                Datos base de la capa
                <InfoButton
                  info={STEP_FIELD_INFO.datos_negocio}
                  onInfo={setFieldInfo}
                />
              </span>
            </h3>
          </div>
          {showInlineCapaSaveAction ? (
            <button
              type="button"
              onClick={() => onSaveCapa("Se guardaron los datos del negocio.")}
              disabled={savingCapa || loadingCapa || hasValidationErrors(businessDataErrors)}
              className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveLabel}
            </button>
          ) : null}
        </div>
        {loadingLabel}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <FormField
            label="Nombre de la administracion"
            value={capaForm.nombre}
            onChange={(nombre) => updateCapaForm({ nombre })}
            placeholder="Maya Coliving"
            required
            maxLength={120}
            error={businessDataErrors.nombre}
            helper="Nombre operativo visible para el equipo."
            info={BUSINESS_FIELD_INFO.nombre}
            onInfo={setFieldInfo}
          />
          <SelectField
            label="Tipo de capa"
            value={capaForm.tipo_capa}
            options={TIPOS_CAPA}
            onChange={(tipo_capa) => updateCapaForm({ tipo_capa })}
            required
            info={BUSINESS_FIELD_INFO.tipoCapa}
            onInfo={setFieldInfo}
          />
          <FormField
            label="Administrador responsable"
            value={capaForm.nombre_administrador}
            onChange={(nombre_administrador) =>
              updateCapaForm({
                nombre_administrador: sanitizeLettersInput(nombre_administrador, 120),
              })
            }
            placeholder="Nombre del responsable"
            required
            maxLength={120}
            error={businessDataErrors.nombre_administrador}
            helper="Solo letras, espacios y signos basicos de nombre."
            info={BUSINESS_FIELD_INFO.administrador}
            onInfo={setFieldInfo}
          />
          <FormField
            label="Correo operativo"
            type="email"
            inputMode="email"
            value={capaForm.correo_contacto}
            onChange={(correo_contacto) => updateCapaForm({ correo_contacto })}
            placeholder="operacion@empresa.com"
            required
            maxLength={254}
            error={businessDataErrors.correo_contacto}
            info={BUSINESS_FIELD_INFO.correo}
            onInfo={setFieldInfo}
          />
          <FormField
            label="Telefono operativo"
            type="tel"
            inputMode="tel"
            value={capaForm.telefono_contacto}
            onChange={(telefono_contacto) =>
              updateCapaForm({ telefono_contacto: sanitizePhoneInput(telefono_contacto) })
            }
            placeholder="55..."
            required
            maxLength={16}
            error={businessDataErrors.telefono_contacto}
            helper="10 digitos Mexico o hasta 15 con lada internacional."
            info={BUSINESS_FIELD_INFO.telefono}
            onInfo={setFieldInfo}
          />
          <FormField
            label="Pais fiscal"
            value={capaForm.pais_fiscal}
            onChange={(pais_fiscal) =>
              updateCapaForm({ pais_fiscal: sanitizeLettersInput(pais_fiscal, 80) })
            }
            required
            maxLength={80}
            error={businessDataErrors.pais_fiscal}
            helper="Solo letras y espacios."
            info={BUSINESS_FIELD_INFO.paisFiscal}
            onInfo={setFieldInfo}
          />
        </div>
      </div>
    );
  }

  if (step.id === "reglas_capa") {
    return (
      <div className={editorShellClass}>
        {fieldInfoModal}
        {suggestedRuleWizard ? (
          <SuggestedRuleWizardModal
            rule={suggestedRuleWizard.rules[suggestedRuleWizard.index]}
            form={suggestedRuleWizard.form}
            index={suggestedRuleWizard.index}
            total={suggestedRuleWizard.rules.length}
            saving={suggestedRuleWizard.saving}
            error={suggestedRuleWizard.error}
            ruleCatalogs={ruleCatalogs}
            onUpdate={updateSuggestedRuleWizardForm}
            onClose={() => setSuggestedRuleWizard(null)}
            onSave={saveSuggestedRuleWizardStep}
          />
        ) : null}
        {ruleEditorModalOpen ? (
          <BusinessRuleEditorModal
            form={ruleForm}
            saving={savingBusinessRule}
            error={ruleEditorError}
            ruleCatalogs={ruleCatalogs}
            onUpdate={(patch) => {
              updateRuleForm(patch);
              setRuleEditorError("");
            }}
            onClose={closeBusinessRuleModal}
            onSave={saveBusinessRuleEditor}
          />
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.26em] text-cyan-200">
              Paso 2
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white">
              <span className="inline-flex items-center gap-2">
                Reglas operativas heredables
                <InfoButton
                  info={STEP_FIELD_INFO.reglas_capa}
                  onInfo={setFieldInfo}
                />
              </span>
            </h3>
          </div>
        </div>
        {loadingLabel}
        <div className="mt-4 grid gap-2 rounded-2xl border border-white/8 bg-zinc-950/60 p-2 md:grid-cols-2">
          {[
            {
              id: "cobro" as const,
              label: "2.1 Cobro, gracia y aplicacion de pagos",
            },
            {
              id: "reglas" as const,
              label: "2.2 Reglas heredables",
            },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => changeRulesTab(tab.id)}
              className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                rulesTab === tab.id
                  ? "border-cyan-400/40 bg-cyan-500/15 text-white"
                  : "border-transparent bg-transparent text-zinc-400 hover:border-white/10 hover:text-zinc-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {rulesTab === "cobro" ? (
          <>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {[
            {
              title: "1. Corte",
              copy:
                dueMode === "global"
                  ? "Todas las nuevas ocupaciones toman el mismo dia base."
                  : "Cada cliente conserva el dia de corte de su contrato.",
            },
            {
              title: "2. Gracia",
              copy: `${capaForm.dias_gracia_default || 0} dias antes de marcar un cobro como vencido.`,
            },
            {
              title: "3. Reglas",
              copy:
                businessRules.filter((rule) => rule.activo).length > 0
                  ? "Las reglas activas se heredaran en nuevas unidades."
                  : "Activa plantillas o crea reglas solo si aplican desde el inicio.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4"
            >
              <p className="text-[11px] uppercase tracking-[0.2em] text-cyan-200">
                {item.title}
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-300">{item.copy}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {[
            {
              label: "Modelo de corte",
              value: dueMode === "global" ? "Misma fecha" : "Fecha individual",
              copy:
                dueMode === "global"
                  ? "Vencimiento uniforme para toda la capa."
                  : "Vencimiento segun cada contrato.",
            },
            {
              label: "Dia base",
              value:
                dueMode === "global"
                  ? capaForm.dia_vencimiento_default || "Pendiente"
                  : "Por cliente",
              copy:
                dueMode === "global"
                  ? "Se aplica al crear nuevas ocupaciones."
                  : "Se captura al importar o asignar espacios.",
            },
            {
              label: "Gracia",
              value: `${capaForm.dias_gracia_default || 0} dias`,
              copy: "Ventana antes de clasificar como vencido.",
            },
            {
              label: "Reglas activas",
              value: String(businessRules.filter((rule) => rule.activo).length),
              copy:
                suggestedPendingCount > 0
                  ? `${suggestedPendingCount} plantillas pendientes.`
                  : "Base lista para heredar.",
            },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-white/8 bg-zinc-950/65 p-4"
            >
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                {item.label}
              </p>
              <p className="mt-2 text-lg font-semibold text-white">{item.value}</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{item.copy}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
          <div className="rounded-2xl border border-white/8 bg-zinc-950/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                  Corte y vencimiento
                </p>
                <h4 className="mt-1 text-base font-semibold text-white">
                  <span className="inline-flex items-center gap-2">
                    Define la fecha de cobro
                    <InfoButton
                      info={RULES_FIELD_INFO.corte}
                      onInfo={setFieldInfo}
                    />
                  </span>
                </h4>
                <p className="mt-1 text-sm leading-6 text-zinc-400">
                  Usa una fecha global para cuotas administrativas o corte
                  individual cuando cada contrato tenga condiciones propias.
                </p>
              </div>
              {dueMode === "global" ? (
                <div className="w-full max-w-[180px]">
                  <FormField
                    label="Dia global"
                    type="text"
                    inputMode="numeric"
                    min={1}
                    max={31}
                    maxLength={2}
                    numericOnly
                    value={capaForm.dia_vencimiento_default}
                    onChange={(dia_vencimiento_default) =>
                      updateCapaForm({
                        dia_vencimiento_default: sanitizeIntegerInput(
                          dia_vencimiento_default,
                          2
                        ),
                      })
                    }
                    placeholder="Ej. 15"
                    required
                    helper="Solo numeros enteros del 1 al 31."
                    error={rulesErrors.dia_vencimiento_default}
                    info={RULES_FIELD_INFO.diaGlobal}
                    onInfo={setFieldInfo}
                  />
                </div>
              ) : null}
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <DueModeButton
                active={dueMode === "global"}
                title="Misma fecha"
                copy="Ideal para condominios, cuotas y cargos administrativos."
                onClick={() => onDueModeChange("global")}
              />
              <DueModeButton
                active={dueMode === "individual"}
                title="Fecha individual"
                copy="Ideal para rentas, coliving o contratos con cortes distintos."
                onClick={() => onDueModeChange("individual")}
              />
            </div>
            <div className="mt-3 rounded-2xl border border-white/8 bg-zinc-950/70 px-4 py-3 text-sm leading-6 text-zinc-400">
              {dueMode === "global"
                ? "Con esta configuracion, las nuevas ocupaciones heredan el dia global salvo que despues hagas una excepcion."
                : "Con esta configuracion, el dia se define en la asignacion, importacion o edicion del cliente."}
            </div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-zinc-950/60 p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
              Politica base
            </p>
            <div className="mt-3 grid gap-3">
              <SelectField
                label="Periodicidad default"
                value={capaForm.periodicidad_cobro_default}
                options={PERIODICIDADES}
                onChange={(periodicidad_cobro_default) =>
                  updateCapaForm({ periodicidad_cobro_default })
                }
                required
                error={rulesErrors.periodicidad_cobro_default}
                info={RULES_FIELD_INFO.periodicidad}
                onInfo={setFieldInfo}
              />
              <FormField
                label="Dias de gracia"
                type="text"
                inputMode="numeric"
                min={0}
                max={365}
                maxLength={3}
                numericOnly
                value={capaForm.dias_gracia_default}
                onChange={(dias_gracia_default) =>
                  updateCapaForm({
                    dias_gracia_default: sanitizeIntegerInput(dias_gracia_default, 3),
                  })
                }
                required
                helper="Solo numeros enteros de 0 a 365."
                error={rulesErrors.dias_gracia_default}
                info={RULES_FIELD_INFO.gracia}
                onInfo={setFieldInfo}
              />
              <SelectField
                label="Aplicacion de pagos"
                value={capaForm.aplicacion_pagos}
                options={APLICACION_PAGOS}
                onChange={(aplicacion_pagos) =>
                  updateCapaForm({ aplicacion_pagos })
                }
                required
                error={rulesErrors.aplicacion_pagos}
                info={RULES_FIELD_INFO.aplicacionPagos}
                onInfo={setFieldInfo}
              />
              <CheckboxField
                label="Renovacion automatica default"
                helper="Las nuevas ocupaciones heredan esta regla salvo excepcion."
                checked={capaForm.auto_renueva_default}
                onChange={(auto_renueva_default) =>
                  updateCapaForm({ auto_renueva_default })
                }
                info={RULES_FIELD_INFO.renovacion}
                onInfo={setFieldInfo}
              />
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              Esta politica es la base operativa. Las excepciones se ajustan por
              cliente o contrato cuando sea necesario.
            </p>
          </div>
        </div>

        {showInlineCapaSaveAction ? (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => onSaveCapa("Se guardaron las reglas generales.")}
              disabled={savingCapa || loadingCapa || hasValidationErrors(rulesErrors)}
              className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveLabel}
            </button>
          </div>
        ) : null}
          </>
        ) : null}

        {rulesTab === "reglas" ? (
          <>
        <div className="mt-4 rounded-2xl border border-white/8 bg-zinc-950/65">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                Reglas predefinidas
              </p>
              <h4 className="mt-1 text-base font-semibold text-white">
                <span className="inline-flex items-center gap-2">
                  Plantillas listas para activar
                  <InfoButton
                    info={RULES_FIELD_INFO.plantillaReglas}
                    onInfo={setFieldInfo}
                  />
                </span>
              </h4>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                Activa solo las reglas que usaras al inicio. Despues puedes ajustar
                montos, porcentajes y condiciones.
              </p>
            </div>
            {suggestedPendingCount > 0 ? (
              <button
                type="button"
                onClick={openSuggestedRuleWizard}
                disabled={!selectedSuggestedRules.length || savingBusinessRule}
                className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:border-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {selectedSuggestedRules.length
                  ? `Crear seleccionadas (${selectedSuggestedRules.length})`
                  : "Selecciona reglas"}
              </button>
            ) : null}
          </div>

          <div className="divide-y divide-white/8">
            {suggestedRules.map((rule) => {
              const selected = selectedSuggestedRuleNames.includes(rule.nombre);
              return (
              <label
                key={rule.nombre}
                className={`grid gap-3 border-l-2 px-4 py-3 transition md:grid-cols-[minmax(0,1fr)_180px_140px_120px] md:items-center ${
                  rule.ya_existe
                    ? "cursor-default border-l-emerald-500/50 bg-emerald-500/5"
                    : selected
                      ? "cursor-pointer border-l-cyan-400/70 bg-cyan-500/10"
                      : "cursor-pointer border-l-amber-500/50 bg-zinc-900/45 hover:bg-zinc-900/75"
                }`}
              >
                <div className="flex min-w-0 gap-3">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={rule.ya_existe}
                    onChange={() => toggleSuggestedRuleSelection(rule.nombre)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-700 bg-zinc-950 text-cyan-400 disabled:opacity-40"
                  />
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold leading-5 text-white">
                      {rule.nombre}
                    </p>
                    <p className="mt-1 break-words text-xs leading-5 text-zinc-500">
                      {rule.descripcion}
                    </p>
                  </div>
                </div>
                <div className="text-sm text-zinc-300">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    Calculo
                  </p>
                  <p className="mt-1 leading-5">
                    {rule.tipo_calculo_label || rule.tipo_calculo}
                  </p>
                  <p className="mt-1 font-semibold text-white">
                    {ruleValueLabel(rule)}
                  </p>
                </div>
                <div className="text-sm text-zinc-400">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    Frecuencia
                  </p>
                  <p className="mt-1 leading-5">
                    {rule.periodicidad_label || rule.periodicidad}
                  </p>
                </div>
                <div className="flex md:justify-end">
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${
                      rule.ya_existe
                        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                        : "border-amber-500/25 bg-amber-500/10 text-amber-200"
                    }`}
                  >
                    {rule.ya_existe ? "Activa" : "Pendiente"}
                  </span>
                </div>
              </label>
            );
            })}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200">
                Regla personalizada
              </p>
              <h4 className="mt-1 text-base font-semibold text-white">
                Crear regla manual
              </h4>
              <p className="mt-1 text-sm leading-6 text-zinc-400">
                Abre el modal para capturar una regla heredable que no venga en las
                plantillas predefinidas.
              </p>
            </div>
            <button
              type="button"
              onClick={openNewBusinessRuleModal}
              disabled={savingBusinessRule}
              className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Nueva regla
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/8 bg-zinc-950/65">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                Reglas heredables activas
              </p>
              <h4 className="mt-1 text-base font-semibold text-white">
                Listado editable de la capa
              </h4>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                Revisa que la capa tenga solo reglas vigentes antes de importar
                clientes y espacios.
              </p>
            </div>
            <span className="rounded-full border border-white/8 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
              {businessRules.length} reglas
            </span>
          </div>

          {businessRules.length ? (
            <div className="divide-y divide-white/8">
              {businessRules.map((rule) => (
                <div
                  key={rule.id}
                  className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_180px_160px_160px]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-white">
                        {rule.nombre}
                      </p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${
                          rule.activo
                            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                            : "border-zinc-700 bg-zinc-900 text-zinc-400"
                        }`}
                      >
                        {rule.activo ? "Activa" : "Inactiva"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {ruleConditionLabel(rule)}
                    </p>
                  </div>
                  <div className="text-sm text-zinc-300">
                    <p>{rule.tipo_calculo_label || rule.tipo_calculo}</p>
                    <p className="mt-1 font-semibold text-white">
                      {businessRuleValueLabel(rule)}
                    </p>
                  </div>
                  <div className="text-sm text-zinc-400">
                    {rule.periodicidad_label || rule.periodicidad}
                  </div>
                  <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                    <button
                      type="button"
                      onClick={() => openEditBusinessRuleModal(rule)}
                      className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100 transition hover:border-cyan-400/60"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => onRequestDeleteBusinessRule(rule)}
                      disabled={deletingRuleId === rule.id}
                      className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-100 transition hover:border-rose-400/60 disabled:opacity-50"
                    >
                      {deletingRuleId === rule.id ? "Borrando" : "Borrar"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              Aun no hay reglas heredables. Crea las reglas base o agrega una personalizada.
            </div>
          )}
        </div>
          </>
        ) : null}
      </div>
    );
  }

  if (step.id === "carga_batch") {
    const hasBatchErrorReport = Boolean(batchErrorReport);
    return (
      <div className={editorShellClass}>
        {fieldInfoModal}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.26em] text-cyan-200">
              Migracion desde Excel
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white">
              <span className="inline-flex items-center gap-2">
                Descarga, llena e importa la operacion
                <InfoButton
                  info={STEP_FIELD_INFO.carga_batch}
                  onInfo={setFieldInfo}
                />
              </span>
            </h3>
          </div>
          <button
            type="button"
            onClick={onDownloadBatchTemplate}
            className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-400/60"
          >
            Descargar plantilla
          </button>
        </div>
        <div className="mt-4 rounded-2xl border border-dashed border-white/12 bg-zinc-950/70 p-4">
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
              <span className="inline-flex items-center gap-2">
                Archivo batch
                <InfoButton
                  info={BATCH_FIELD_INFO.archivoOperacion}
                  onInfo={setFieldInfo}
                />
              </span>
              <span className="ml-2 text-cyan-200">Obligatorio para importar</span>
            </span>
            <input
              type="file"
              accept=".xlsx,.xlsm,.csv"
              onChange={(event) =>
                onBatchFileChange(event.target.files?.[0] || null)
              }
              className={`mt-2 ${inputClassName("file:mr-4 file:rounded-xl file:border-0 file:bg-zinc-800 file:px-4 file:py-2 file:text-zinc-100")}`}
            />
          </label>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-400">
              {batchFile
                ? batchFile.name
                : "Compatible con .xlsx, .xlsm y .csv. Selecciona un archivo para importar."}
            </p>
            <button
              type="button"
              onClick={onImportBatch}
              disabled={!batchFile || importingBatch}
              className="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importingBatch ? "Importando" : "Importar archivo"}
            </button>
          </div>
          {batchMessage ? (
            <div
              className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
                hasBatchErrorReport
                  ? "border-amber-500/25 bg-amber-500/10 text-amber-50"
                  : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>{batchMessage}</span>
                {batchErrorReport ? (
                  <button
                    type="button"
                    onClick={onDownloadBatchErrorReport}
                    className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:border-amber-300/60"
                  >
                    Descargar errores ({batchErrorReport.rows})
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (step.id === "cxp_batch") {
    const selectedPrograms = cxpPrograms.filter(
      (program) => String(program.entidad_id) === cxpEntityId
    );
    const selectedEntity = cxpEntities.find(
      (entity) => String(entity.id) === cxpEntityId
    );
    const presetExists = (preset: (typeof CXP_FIXED_PAYMENT_PRESETS)[number]) =>
      selectedPrograms.some(
        (program) =>
          program.categoria === preset.categoria ||
          safeText(program.nombre).toLowerCase() === preset.label.toLowerCase()
      );
    const selectedPresetsToCreate = CXP_FIXED_PAYMENT_PRESETS.filter(
      (preset) =>
        cxpSelectedPresetKeys.includes(preset.key) && !presetExists(preset)
    );
    const hasSelectedPresetToCreate = selectedPresetsToCreate.length > 0;
    const isEditingCxpProgram = Boolean(cxpProgramForm.id);
    const updateCxpPresetWizardForm = (patch: Partial<CxpProgramFormState>) => {
      const currentPreset = cxpPresetWizard?.presets[cxpPresetWizard.index];
      if (currentPreset && patch.monto_base !== undefined) {
        onCxpPresetAmountChange(currentPreset.key, patch.monto_base);
      }
      setCxpPresetWizard((current) =>
        current
          ? {
              ...current,
              form: { ...current.form, ...patch },
              error: "",
            }
          : current
      );
    };
    const openCxpPresetWizard = () => {
      if (!cxpEntityId || !selectedPresetsToCreate.length) {
        return;
      }
      const firstPreset = selectedPresetsToCreate[0];
      setCxpPresetWizard({
        presets: selectedPresetsToCreate,
        index: 0,
        form: mapCxpPresetToForm(
          firstPreset,
          parseMoneyInput(cxpPresetAmounts[firstPreset.key]),
          capaForm,
          cxpEntityId
        ),
        error: "",
        saving: false,
      });
    };
    const saveCxpPresetWizardStep = async () => {
      if (!cxpPresetWizard) {
        return;
      }
      const validationErrors = validateCxpProgramForm(cxpPresetWizard.form);
      if (hasValidationErrors(validationErrors)) {
        setCxpPresetWizard((current) =>
          current
            ? {
                ...current,
                error:
                  Object.values(validationErrors).find(Boolean) ||
                  "Revisa los campos de la cuenta por pagar.",
              }
            : current
        );
        return;
      }

      setCxpPresetWizard((current) =>
        current ? { ...current, saving: true, error: "" } : current
      );
      const result = await onCreateCxpProgramFromForm({
        ...cxpPresetWizard.form,
        id: null,
      });
      if (!result.ok) {
        setCxpPresetWizard((current) =>
          current
            ? {
                ...current,
                saving: false,
                error:
                  result.error ||
                  "No se pudo crear la cuenta por pagar seleccionada.",
              }
            : current
        );
        return;
      }

      const nextIndex = cxpPresetWizard.index + 1;
      if (nextIndex >= cxpPresetWizard.presets.length) {
        cxpPresetWizard.presets.forEach((preset) => {
          if (cxpSelectedPresetKeys.includes(preset.key)) {
            onToggleCxpPreset(preset.key);
          }
        });
        setCxpPresetWizard(null);
        return;
      }
      const nextPreset = cxpPresetWizard.presets[nextIndex];
      const nextEntityId = cxpPresetWizard.form.entidad_id || cxpEntityId;
      setCxpPresetWizard({
        presets: cxpPresetWizard.presets,
        index: nextIndex,
        form: mapCxpPresetToForm(
          nextPreset,
          parseMoneyInput(cxpPresetAmounts[nextPreset.key]),
          capaForm,
          nextEntityId
        ),
        error: "",
        saving: false,
      });
    };

    return (
      <div className={editorShellClass}>
        {fieldInfoModal}
        {cxpPresetWizard ? (
          <CxpPresetWizardModal
            preset={cxpPresetWizard.presets[cxpPresetWizard.index]}
            form={cxpPresetWizard.form}
            index={cxpPresetWizard.index}
            total={cxpPresetWizard.presets.length}
            entities={cxpEntities}
            saving={cxpPresetWizard.saving}
            error={cxpPresetWizard.error}
            onUpdate={updateCxpPresetWizardForm}
            onClose={() => setCxpPresetWizard(null)}
            onSave={saveCxpPresetWizardStep}
          />
        ) : null}
        {cxpEditorModalOpen ? (
          <CxpProgramEditorModal
            form={cxpProgramForm}
            entities={cxpEntities}
            saving={savingCxpProgram}
            error={cxpEditorError}
            eyebrow={
              cxpEntities.find(
                (entity) => String(entity.id) === cxpProgramForm.entidad_id
              )?.nombre ||
              selectedEntity?.nombre ||
              "Unidad por definir"
            }
            title={
              isEditingCxpProgram
                ? `Editar ${cxpProgramForm.nombre || "CxP"}`
                : "Agregar CxP manual"
            }
            description={
              isEditingCxpProgram
                ? "Ajusta los datos de esta cuenta por pagar para la unidad activa."
                : "Captura un compromiso por pagar que no venga en las plantillas predefinidas."
            }
            saveLabel={isEditingCxpProgram ? "Guardar cambios" : "Crear CxP"}
            onUpdate={(patch) => {
              onUpdateCxpProgramForm(patch);
              setCxpEditorError("");
            }}
            onClose={closeCxpProgramModal}
            onSave={saveCxpProgramEditor}
          />
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.26em] text-cyan-200">
              Cuentas por pagar
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white">
              <span className="inline-flex items-center gap-2">
                Pagos fijos y carga batch de compromisos
                <InfoButton
                  info={STEP_FIELD_INFO.cxp_batch}
                  onInfo={setFieldInfo}
                />
              </span>
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              CxP concentra lo que tu operacion debe pagar: servicios, renta,
              administracion, impuestos y proveedores. Con esto BetterP compara
              ingresos esperados contra compromisos reales antes de que se venzan.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 rounded-2xl border border-white/8 bg-zinc-950/60 p-2 md:grid-cols-2">
          {[
            { id: "manual" as const, label: "4.1 CxP manual" },
            { id: "batch" as const, label: "4.2 Carga batch" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => changeCxpTab(tab.id)}
              className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                cxpTab === tab.id
                  ? "border-cyan-400/40 bg-cyan-500/15 text-white"
                  : "border-transparent bg-transparent text-zinc-400 hover:border-white/10 hover:text-zinc-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {cxpTab === "manual" ? (
          <>
            <div className="mt-4 rounded-2xl border border-white/8 bg-zinc-950/65 p-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                <SelectField
                  label="Unidad / edificio"
                  value={cxpEntityId}
                  options={[
                    { value: "", label: "Selecciona unidad" },
                    ...cxpEntities.map((entity) => ({
                      value: String(entity.id),
                      label: entity.ciudad
                        ? `${entity.nombre} - ${entity.ciudad}`
                        : entity.nombre,
                    })),
                  ]}
                  onChange={onCxpEntityChange}
                  info={CXP_FIELD_INFO.unidad}
                  onInfo={setFieldInfo}
                />
                <button
                  type="button"
                  onClick={openNewCxpProgramModal}
                  disabled={!cxpEntities.length || savingCxpProgram}
                  className="self-end rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Agregar CxP manual
                </button>
                <button
                  type="button"
                  onClick={openCxpPresetWizard}
                  disabled={
                    !cxpEntityId ||
                    savingCxpProgram ||
                    !hasSelectedPresetToCreate
                  }
                  className="self-end rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {hasSelectedPresetToCreate
                    ? `Configurar seleccionadas (${selectedPresetsToCreate.length})`
                    : "Selecciona CxP"}
                </button>
              </div>

              {cxpEntities.length ? (
                <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                  {CXP_FIXED_PAYMENT_PRESETS.map((preset) => {
                    const exists = presetExists(preset);
                    const selected = cxpSelectedPresetKeys.includes(preset.key);
                    return (
                      <label
                        key={preset.key}
                        className={`min-w-0 rounded-2xl border p-3 ${
                          exists
                            ? "border-emerald-500/20 bg-emerald-500/5"
                            : selected
                              ? "border-cyan-400/40 bg-cyan-500/10"
                              : "border-white/8 bg-zinc-900/70"
                        }`}
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={exists}
                            onChange={() => onToggleCxpPreset(preset.key)}
                            className="mt-1 h-4 w-4 shrink-0 rounded border-zinc-700 bg-zinc-950 text-cyan-400 disabled:opacity-40"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-white">
                              {preset.label}
                            </span>
                            <span className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">
                              {preset.proveedor}
                            </span>
                          </span>
                          {exists ? (
                            <span className="shrink-0 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200">
                              Activa
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <span className="rounded-full border border-white/8 bg-zinc-950/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-400">
                            {preset.prioridad}
                          </span>
                          <span className="rounded-full border border-white/8 bg-zinc-950/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                            {preset.categoria}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-50">
                  Primero importa o crea una unidad de negocio. Despues podras preparar
                  los pagos fijos de cada edificio.
                </div>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-white/8 bg-zinc-950/65 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                    CxP registradas
                  </p>
                  <h4 className="mt-1 text-base font-semibold text-white">
                    {selectedEntity?.nombre || "Unidad sin seleccionar"}
                  </h4>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    Aqui quedan listas las CxP manuales y las plantillas que ya configuraste.
                  </p>
                </div>
                <span className="rounded-full border border-white/8 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
                  {selectedPrograms.length} CxP
                </span>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {selectedPrograms.length ? (
                  selectedPrograms.map((program) => (
                    <div
                      key={program.id}
                      className="rounded-2xl border border-white/8 bg-zinc-900/70 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">
                            {program.nombre}
                          </p>
                          <p className="mt-1 truncate text-xs text-zinc-500">
                            {program.proveedor_nombre || "Proveedor pendiente"} -{" "}
                            {program.periodicidad}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-cyan-100">
                          {formatCurrency(program.monto_base)}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openEditCxpProgramModal(program)}
                          className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:border-cyan-400/60"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => onRequestDeleteCxpProgram(program)}
                          disabled={deletingCxpProgramId === program.id}
                          className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-100 transition hover:border-rose-400/60 disabled:opacity-50"
                        >
                          {deletingCxpProgramId === program.id ? "Borrando" : "Borrar"}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-2xl border border-dashed border-white/10 p-4 text-sm leading-6 text-zinc-500 md:col-span-2 xl:col-span-3">
                    Aun no hay CxP registradas para esta unidad.
                  </p>
                )}
              </div>
            </div>
          </>
        ) : null}

        {cxpTab === "batch" ? (
          <div className="mt-4 rounded-2xl border border-white/8 bg-zinc-950/65 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                  Batch CxP
                </p>
                <h4 className="mt-1 text-base font-semibold text-white">
                  Importa proveedores y compromisos
                </h4>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">
                  La plantilla incluye ejemplos ficticios, descripcion de columnas y
                  selectores para periodicidad, categoria, naturaleza y prioridad.
                </p>
              </div>
              <button
                type="button"
                onClick={onDownloadCxpBatchTemplate}
                className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-400/60"
              >
                Descargar plantilla CxP
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <MonthPeriodPicker
                label="Mes de carga"
                value={cxpBatchPeriod}
                onChange={onCxpBatchPeriodChange}
                required
                helper="BetterP genera los cargos dentro de este mes. Si el Excel no trae fecha de vencimiento, usaremos el ultimo dia del mes."
                info={CXP_FIELD_INFO.periodo}
                onInfo={setFieldInfo}
              />
              <label className="block">
                <span className={fieldLabelClassName}>
                  <span className="inline-flex items-center gap-2">
                    Archivo CxP
                    <InfoButton
                      info={CXP_FIELD_INFO.archivoCxp}
                      onInfo={setFieldInfo}
                    />
                  </span>
                  <span className="ml-2 text-cyan-200">Obligatorio</span>
                </span>
                <input
                  type="file"
                  accept=".xlsx,.xlsm,.csv"
                  onChange={(event) =>
                    onCxpBatchFileChange(event.target.files?.[0] || null)
                  }
                  className={`mt-2 ${inputClassName("file:mr-4 file:rounded-xl file:border-0 file:bg-zinc-800 file:px-4 file:py-2 file:text-zinc-100")}`}
                />
                <span className="mt-2 block text-xs leading-5 text-zinc-500">
                  Formatos permitidos: .xlsx, .xlsm y .csv.
                </span>
              </label>
            </div>
            <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">
              Para cargos variables, captura en MONTO el importe real de este periodo
              antes de importar. BetterP omitira importes en cero para evitar CxP
              incompletas.
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-zinc-400">
                {cxpBatchFile
                  ? cxpBatchFile.name
                  : "Selecciona un archivo para importar compromisos por pagar."}
              </p>
              <button
                type="button"
                onClick={onImportCxpBatch}
                disabled={!cxpBatchFile || importingCxpBatch}
                className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importingCxpBatch ? "Importando" : "Importar CxP"}
              </button>
            </div>
            {cxpBatchMessage ? (
              <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {cxpBatchMessage}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (step.id === "portal_facturacion") {
    return (
      <div className={editorShellClass}>
        {fieldInfoModal}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.26em] text-cyan-200">
              Portal y facturacion
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white">
              <span className="inline-flex items-center gap-2">
                Datos fiscales, banco y portal del cliente final
                <InfoButton
                  info={STEP_FIELD_INFO.portal_facturacion}
                  onInfo={setFieldInfo}
                />
              </span>
            </h3>
          </div>
          {showInlineCapaSaveAction ? (
            <button
              type="button"
              onClick={() => onSaveCapa("Se guardaron portal y facturacion.")}
              disabled={savingCapa || loadingCapa || hasValidationErrors(portalBillingErrors)}
              className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveLabel}
            </button>
          ) : null}
        </div>
        {loadingLabel}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <SelectField
            label="Tipo de persona fiscal"
            value={capaForm.es_persona_moral ? "moral" : "fisica"}
            options={PERSONA_FISCAL_OPTIONS}
            onChange={(tipoPersona) => {
              const esPersonaMoral = tipoPersona === "moral";
              updateCapaForm({
                es_persona_moral: esPersonaMoral,
                regimen_fiscal: normalizeOperationalFiscalRegimeValue(
                  capaForm.regimen_fiscal,
                  esPersonaMoral
                ),
              });
            }}
            required
            info={PORTAL_FIELD_INFO.tipoPersona}
            onInfo={setFieldInfo}
          />
          <FormField
            label="Nombre / razon social"
            value={capaForm.razon_social}
            onChange={(razon_social) => updateCapaForm({ razon_social })}
            required
            maxLength={160}
            error={portalBillingErrors.razon_social}
            info={PORTAL_FIELD_INFO.razonSocial}
            onInfo={setFieldInfo}
          />
          <FormField
            label="RFC"
            value={capaForm.rfc}
            maxLength={13}
            required
            helper="Persona moral usa 12 caracteres; persona fisica usa 13."
            error={portalBillingErrors.rfc}
            info={PORTAL_FIELD_INFO.rfc}
            onInfo={setFieldInfo}
            onChange={(rfc) => {
              const nextRfc = rfc.toUpperCase();
              const digitsOnly = sanitizeAlphaNumeric(nextRfc, 13);
              updateCapaForm({
                rfc: digitsOnly,
                ...(digitsOnly.length === 12
                  ? {
                      es_persona_moral: true,
                      regimen_fiscal: normalizeOperationalFiscalRegimeValue(
                        capaForm.regimen_fiscal,
                        true
                      ),
                    }
                  : digitsOnly.length === 13
                    ? {
                        es_persona_moral: false,
                        regimen_fiscal: normalizeOperationalFiscalRegimeValue(
                          capaForm.regimen_fiscal,
                          false
                        ),
                      }
                    : {}),
              });
            }}
          />
          <SelectField
            label="Regimen fiscal"
            value={capaForm.regimen_fiscal}
            options={fiscalRegimeOptions}
            onChange={(regimen_fiscal) => updateCapaForm({ regimen_fiscal })}
            required
            error={portalBillingErrors.regimen_fiscal}
            info={PORTAL_FIELD_INFO.regimenFiscal}
            onInfo={setFieldInfo}
          />
          <FormField
            label="Codigo postal fiscal"
            value={capaForm.codigo_postal_fiscal}
            inputMode="numeric"
            maxLength={5}
            numericOnly
            onChange={(codigo_postal_fiscal) =>
              updateCapaForm({
                codigo_postal_fiscal: sanitizeIntegerInput(codigo_postal_fiscal, 5),
              })
            }
            required
            helper="Solo numeros. Debe tener 5 digitos."
            error={portalBillingErrors.codigo_postal_fiscal}
            info={PORTAL_FIELD_INFO.codigoPostal}
            onInfo={setFieldInfo}
          />
          <SelectField
            label="Banco"
            value={capaForm.banco_transferencias}
            options={bankOptionsForValue(capaForm.banco_transferencias)}
            onChange={(banco_transferencias) =>
              updateCapaForm({ banco_transferencias })
            }
            required
            error={portalBillingErrors.banco_transferencias}
            info={PORTAL_FIELD_INFO.banco}
            onInfo={setFieldInfo}
          />
          <FormField
            label="CLABE"
            value={capaForm.clabe_transferencias}
            inputMode="numeric"
            maxLength={18}
            numericOnly
            required
            helper={
              clabeValidation.message ||
              "18 digitos. BetterP valida el digito verificador y detecta banco."
            }
            error={portalBillingErrors.clabe_transferencias}
            info={PORTAL_FIELD_INFO.clabe}
            onInfo={setFieldInfo}
            onChange={(clabe_transferencias) => {
              const normalizedClabe = clabe_transferencias.replace(/\D/g, "").slice(0, 18);
              const bank = getBankFromClabe(normalizedClabe);
              updateCapaForm({
                clabe_transferencias: normalizedClabe,
                ...(bank?.label && bank.code !== "OTRO"
                  ? { banco_transferencias: bank.label }
                  : {}),
              });
            }}
          />
          {capaForm.clabe_transferencias ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm leading-6 md:col-span-2 ${
                clabeValidation.status === "ok"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                  : clabeValidation.status === "warning"
                    ? "border-amber-500/20 bg-amber-500/10 text-amber-100"
                    : "border-rose-500/20 bg-rose-500/10 text-rose-100"
              }`}
            >
              {clabeValidation.message}
              {detectedBank?.label && detectedBank.label !== capaForm.banco_transferencias ? (
                <span className="ml-1">
                  El banco seleccionado debe coincidir con {detectedBank.label}.
                </span>
              ) : null}
            </div>
          ) : null}
          <FormField
            label="Beneficiario"
            value={capaForm.beneficiario_transferencias}
            onChange={(beneficiario_transferencias) =>
              updateCapaForm({ beneficiario_transferencias })
            }
            required
            maxLength={120}
            error={portalBillingErrors.beneficiario_transferencias}
            info={PORTAL_FIELD_INFO.beneficiario}
            onInfo={setFieldInfo}
          />
          <FormField
            label="Prefijo de referencia"
            value={capaForm.referencia_transferencia_prefijo}
            onChange={(referencia_transferencia_prefijo) =>
              updateCapaForm({
                referencia_transferencia_prefijo: sanitizeAlphaNumeric(
                  referencia_transferencia_prefijo,
                  12
                ),
              })
            }
            required
            maxLength={12}
            error={portalBillingErrors.referencia_transferencia_prefijo}
            helper="2 a 12 letras o numeros. Se usa para referencias de pago."
            info={PORTAL_FIELD_INFO.referencia}
            onInfo={setFieldInfo}
          />
          <CheckboxField
            label="Portal de clientes activo"
            helper="Activalo cuando la cartera y datos fiscales ya esten revisados."
            checked={capaForm.portal_clientes_activo}
            onChange={(portal_clientes_activo) =>
              updateCapaForm({ portal_clientes_activo })
            }
            info={PORTAL_FIELD_INFO.portalActivo}
            onInfo={setFieldInfo}
          />
        </div>
      </div>
    );
  }

  if (step.id === "conexiones_renta" || step.id === "conexiones_marketing") {
    const isRentConnection = step.id === "conexiones_renta";
    const connectionCards = isRentConnection
      ? [
          {
            title: "Mercado Libre Inmuebles",
            copy: "Autoriza la cuenta que publicara espacios y recibira preguntas de prospectos.",
            status: "Prioritario",
            checklist: "Cuenta autorizada, entidad ligada y publicaciones listas.",
          },
          {
            title: "Metros Cubicos",
            copy: "Se atiende desde el alcance inmobiliario de Mercado Libre cuando aplique.",
            status: "Incluido",
            checklist: "Inventario disponible y datos comerciales completos.",
          },
          {
            title: "Airbnb y Booking",
            copy: "Deja listo el espacio operativo para cuando esos canales pasen a produccion.",
            status: "En construccion",
            checklist: "Visible como roadmap, sin bloquear el arranque.",
          },
        ]
      : [
          {
            title: "Facebook Pages",
            copy: "Publica comunicados, imagenes, enlaces y disponibilidad desde la pagina del negocio.",
            status: "Disponible",
            checklist: "Pagina autorizada y permisos de publicacion activos.",
          },
          {
            title: "Instagram Business",
            copy: "Conecta la cuenta para publicaciones con imagen o video obligatorio.",
            status: "Disponible",
            checklist: "Cuenta business ligada y media obligatoria validada.",
          },
          {
            title: "WhatsApp cobranza",
            copy: "Marketing no administra tokens ni webhooks; solo muestra estado y uso operativo.",
            status: "Separado",
            checklist: "La conexion tecnica vive en configuracion/backoffice.",
          },
        ];
    const primaryHref = isRentConnection
      ? "/renta-espacios?tab=conexiones"
      : "/marketing?tab=conexiones";
    const secondaryHref = isRentConnection
      ? "/renta-espacios?tab=publicacion"
      : "/marketing?tab=calendario";

    return (
      <div className={editorShellClass}>
        {fieldInfoModal}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.26em] text-cyan-200">
              {isRentConnection ? "Renta de espacios" : "Marketing"}
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white">
              <span className="inline-flex items-center gap-2">
                {isRentConnection
                  ? "Conecta marketplaces para publicar inventario"
                  : "Conecta redes para comunicar y promocionar"}
                <InfoButton
                  info={
                    isRentConnection
                      ? STEP_FIELD_INFO.conexiones_renta
                      : STEP_FIELD_INFO.conexiones_marketing
                  }
                  onInfo={setFieldInfo}
                />
              </span>
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              {isRentConnection
                ? "Este paso concentra las cuentas que publican espacios disponibles. Marketing queda separado para no mezclar anuncios de inventario con comunicados y redes sociales."
                : "Este paso concentra redes sociales y contenido comercial. Las conexiones tecnicas de renta permanecen en el modulo de espacios."}
            </p>
          </div>
          <a
            href={primaryHref}
            className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300"
          >
            {isRentConnection ? "Conectar renta" : "Conectar marketing"}
          </a>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {connectionCards.map((card) => (
            <div
              key={card.title}
              className="rounded-lg border border-white/8 bg-zinc-950/70 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-white">{card.title}</p>
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-100">
                  {card.status}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-zinc-400">{card.copy}</p>
              <p className="mt-3 border-t border-white/8 pt-3 text-xs leading-5 text-zinc-500">
                {card.checklist}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <a
            href={secondaryHref}
            className="w-full rounded-lg border border-white/10 bg-zinc-950/70 p-4 text-sm leading-6 text-zinc-200 transition hover:border-cyan-400/40 hover:bg-cyan-500/10 sm:w-72"
          >
            <span className="block text-[11px] uppercase tracking-[0.22em] text-zinc-500">
              Siguiente vista
            </span>
            <span className="mt-2 block font-semibold text-white">
              {isRentConnection ? "Revisar publicaciones" : "Revisar calendario"}
            </span>
          </a>
        </div>

        {step.bloqueos.length ? (
          <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200">
              Pendientes a resolver
            </p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-50">
              {step.bloqueos.map((blocker) => (
                <li key={blocker}>- {blocker}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  const isCarteraStep = step.id === "cobranza";
  const isRevisionStep = step.id === "revision_operativa";
  const readingTitle = isCarteraStep
    ? "Auditoria del periodo vigente"
    : isRevisionStep
      ? "Lectura ejecutiva de salida"
      : "Este paso se valida con la informacion ya capturada";
  const readingCopy = isCarteraStep
    ? "Este paso no captura datos nuevos: cruza ocupacion, cortes, gracia, rentas y CxC generadas para confirmar que la cartera ya se puede cobrar sin mandar mensajes equivocados."
    : isRevisionStep
      ? "Este cierre comprueba que el dashboard ya tiene datos suficientes para operar por prioridades: cobranza, ocupacion, pagos y oportunidad comercial."
      : "Si acabas de importar datos, crear reglas o registrar pagos, actualiza la lectura para recalcular el avance y detectar pendientes.";

  return (
    <div
      className={`${
        flushTop ? "" : "mt-6 "
      }rounded-[26px] border border-white/8 bg-zinc-900/60 p-5`}
    >
      {fieldInfoModal}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.26em] text-zinc-500">
            {isCarteraStep ? "Control de cobranza" : "Lectura operativa"}
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">
            <span className="inline-flex items-center gap-2">
              {readingTitle}
              <InfoButton
                info={
                  isCarteraStep
                    ? STEP_FIELD_INFO.cobranza
                    : STEP_FIELD_INFO.revision_operativa
                }
                onInfo={setFieldInfo}
              />
            </span>
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            {readingCopy}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-400/60"
        >
          {isCarteraStep ? "Recalcular cartera" : "Actualizar lectura"}
        </button>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {(step.metricas.length
          ? step.metricas
          : [
              { label: "Avance", value: `${step.progreso}%` },
              { label: "Estado", value: statusLabel(step.estado) },
              { label: "Pendientes", value: String(step.bloqueos.length) },
            ]
        ).map((metric) => (
          <div
            key={`${step.id}-reading-${metric.label}`}
            className="rounded-2xl border border-white/8 bg-zinc-950/70 p-4"
          >
            <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">
              {metric.label}
            </p>
            <p className="mt-2 text-lg font-semibold text-white">{metric.value}</p>
          </div>
        ))}
      </div>
      {step.bloqueos.length ? (
        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
          <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200">
            Pendientes a resolver
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-50">
            {step.bloqueos.map((blocker) => (
              <li key={blocker}>- {blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function OnboardingGuideModal({
  data,
  open,
  currentIndex,
  capaForm,
  ruleForm,
  savingBusinessRule,
  deletingRuleId,
  loadingCapa,
  savingCapa,
  batchFile,
  importingBatch,
  batchMessage,
  batchErrorReport,
  cxpEntities,
  cxpPrograms,
  cxpEntityId,
  cxpSelectedPresetKeys,
  cxpPresetAmounts,
  cxpBatchFile,
  cxpBatchPeriod,
  cxpBatchMessage,
  importingCxpBatch,
  cxpProgramForm,
  savingCxpProgram,
  deletingCxpProgramId,
  suggestedPendingCount,
  hasUnsavedCapaChanges,
  onClose,
  onIndexChange,
  onSaveCapa,
  onUpdateCapaForm,
  onUpdateRuleForm,
  onSaveBusinessRule,
  onCreateBusinessRuleFromForm,
  onEditBusinessRule,
  onCancelBusinessRuleEdit,
  onRequestDeleteBusinessRule,
  onDownloadBatchTemplate,
  onBatchFileChange,
  onImportBatch,
  onDownloadBatchErrorReport,
  onCxpEntityChange,
  onToggleCxpPreset,
  onCxpPresetAmountChange,
  onDownloadCxpBatchTemplate,
  onCxpBatchFileChange,
  onCxpBatchPeriodChange,
  onImportCxpBatch,
  onUpdateCxpProgramForm,
  onCreateCxpProgramFromForm,
  onEditCxpProgram,
  onCancelCxpProgramEdit,
  onSaveCxpProgram,
  onRequestDeleteCxpProgram,
  onRefresh,
  onFinish,
}: {
  data: OnboardingPayload;
  open: boolean;
  currentIndex: number;
  capaForm: CapaFormState;
  ruleForm: RuleFormState;
  savingBusinessRule: boolean;
  deletingRuleId: number | null;
  loadingCapa: boolean;
  savingCapa: boolean;
  batchFile: File | null;
  importingBatch: boolean;
  batchMessage: string;
  batchErrorReport: BatchErrorReport | null;
  cxpEntities: OnboardingEntityOption[];
  cxpPrograms: OnboardingCxpProgram[];
  cxpEntityId: string;
  cxpSelectedPresetKeys: string[];
  cxpPresetAmounts: Record<string, string>;
  cxpBatchFile: File | null;
  cxpBatchPeriod: string;
  cxpBatchMessage: string;
  importingCxpBatch: boolean;
  cxpProgramForm: CxpProgramFormState;
  savingCxpProgram: boolean;
  deletingCxpProgramId: number | null;
  suggestedPendingCount: number;
  hasUnsavedCapaChanges: boolean;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onSaveCapa: (label: string) => void;
  onUpdateCapaForm: (patch: Partial<CapaFormState>) => void;
  onUpdateRuleForm: (patch: Partial<RuleFormState>) => void;
  onSaveBusinessRule: () => Promise<RuleSaveResult>;
  onCreateBusinessRuleFromForm: (form: RuleFormState) => Promise<RuleSaveResult>;
  onEditBusinessRule: (rule: BusinessRule) => void;
  onCancelBusinessRuleEdit: () => void;
  onRequestDeleteBusinessRule: (rule: BusinessRule) => void;
  onDownloadBatchTemplate: () => void;
  onBatchFileChange: (file: File | null) => void;
  onImportBatch: () => void;
  onDownloadBatchErrorReport: () => void;
  onCxpEntityChange: (value: string) => void;
  onToggleCxpPreset: (key: string) => void;
  onCxpPresetAmountChange: (key: string, value: string) => void;
  onDownloadCxpBatchTemplate: () => void;
  onCxpBatchFileChange: (file: File | null) => void;
  onCxpBatchPeriodChange: (value: string) => void;
  onImportCxpBatch: () => void;
  onUpdateCxpProgramForm: (patch: Partial<CxpProgramFormState>) => void;
  onCreateCxpProgramFromForm: (
    form: CxpProgramFormState
  ) => Promise<CxpProgramSaveResult>;
  onEditCxpProgram: (program: OnboardingCxpProgram) => void;
  onCancelCxpProgramEdit: () => void;
  onSaveCxpProgram: () => Promise<CxpProgramSaveResult>;
  onRequestDeleteCxpProgram: (program: OnboardingCxpProgram) => void;
  onRefresh: () => void;
  onFinish: () => void;
}) {
  const [gateModal, setGateModal] = useState<{
    title: string;
    body: string;
    action?: "save-capa";
  } | null>(null);
  const [guideRulesTab, setGuideRulesTab] = useState<RulesOnboardingTab>("cobro");
  const [guideCxpTab, setGuideCxpTab] = useState<CxpOnboardingTab>("manual");

  const step = data.pasos[currentIndex] ?? data.pasos[0];
  useEffect(() => {
    if (!open || step.id !== "reglas_capa") {
      setGuideRulesTab("cobro");
    }
    if (!open || step.id !== "cxp_batch") {
      setGuideCxpTab("manual");
    }
  }, [open, step.id]);

  if (!open) return null;

  const guide = GUIDE_COPY[step.id] ?? {
    abc: step.titulo,
    objetivo: step.descripcion,
    captura: step.bloqueos.length ? step.bloqueos : ["Revisa los datos de este paso."],
    resultado: step.por_que_importa,
    consejo: "Avanza cuando este paso refleje tu operacion real.",
  };
  const isFirst = currentIndex === 0;
  const isLast = currentIndex >= data.pasos.length - 1;
  const nextIndex = Math.min(currentIndex + 1, data.pasos.length - 1);
  const previousIndex = Math.max(currentIndex - 1, 0);
  const progressLabel = `${currentIndex + 1} de ${data.pasos.length}`;
  const currentDueMode: GlobalDueMode =
    capaForm.fecha_vencimiento_modo === "INDIVIDUAL" ? "individual" : "global";
  const capaStepErrors = validateCapaStepForm(step.id, capaForm, currentDueMode);
  const currentStepCanSaveCapa = isCapaSaveStep(step.id);
  const currentStepHasUnsavedCapaChanges =
    currentStepCanSaveCapa && hasUnsavedCapaChanges;
  const saveCurrentCapaStep = () => onSaveCapa(capaStepSaveNotice(step.id));
  const isCurrentStepOptional = isOnboardingStepOptional(step);
  const rulesBaseReady = !hasValidationErrors(validateRulesForm(capaForm, currentDueMode));
  const hasActiveBusinessRules = Boolean(
    (data.reglas_marco ?? []).some((rule) => rule.activo)
  );
  const businessDataReady = !hasValidationErrors(validateBusinessDataForm(capaForm));
  const portalBillingReady = !hasValidationErrors(validatePortalBillingForm(capaForm));
  const migrationReady =
    data.metricas.entidades > 0 &&
    data.metricas.espacios > 0 &&
    data.metricas.clientes > 0;
  const cxpReady =
    (data.cxp_programaciones?.length ?? 0) > 0 || data.metricas.cxp_programaciones > 0;
  const isStepReadyLocally = (candidate: OnboardingStep, index: number) => {
    if (isOnboardingStepOptional(candidate)) {
      return true;
    }
    if (index === currentIndex) {
      if (candidate.id === "datos_negocio") {
        return businessDataReady;
      }
      if (candidate.id === "reglas_capa") {
        return rulesBaseReady && hasActiveBusinessRules;
      }
      if (candidate.id === "carga_batch") {
        return migrationReady;
      }
      if (candidate.id === "cxp_batch") {
        return cxpReady;
      }
      if (candidate.id === "portal_facturacion") {
        return portalBillingReady;
      }
    }
    return isOnboardingStepComplete(candidate);
  };
  const currentStepReadyForContinue =
    step.id === "reglas_capa" && guideRulesTab === "cobro"
      ? rulesBaseReady
      : step.id === "cxp_batch" && guideCxpTab === "manual"
        ? true
      : isStepReadyLocally(step, currentIndex);
  const currentStepRequiresCompletion =
    !isCurrentStepOptional && !currentStepReadyForContinue;
  const currentStepGateMessage = () => {
    const firstCapaError = Object.values(capaStepErrors).find(Boolean);
    if (firstCapaError) {
      return firstCapaError;
    }
    if (step.id === "reglas_capa" && guideRulesTab === "reglas" && !hasActiveBusinessRules) {
      return "Selecciona al menos una regla predefinida y completala en el modal, o crea una regla heredable personalizada antes de migrar la operacion.";
    }
    if (step.id === "carga_batch" && !migrationReady) {
      return "Importa la operacion base para crear unidades, espacios y clientes antes de continuar.";
    }
    if (step.id === "cxp_batch" && !cxpReady) {
      return "Crea al menos una programacion de CxP o importa compromisos para que el dashboard tenga obligaciones por pagar.";
    }
    return stepGateMessage(step);
  };

  const openRequiredStepModal = (requiredStep: OnboardingStep) => {
    setGateModal({
      title: "Completa este paso para continuar",
      body:
        requiredStep.id === step.id
          ? currentStepGateMessage()
          : stepGateMessage(requiredStep),
    });
  };

  const tryGoToIndex = (targetIndex: number) => {
    const blockingIndex = data.pasos
      .slice(0, Math.max(targetIndex, 0))
      .findIndex((candidate, index) => !isStepReadyLocally(candidate, index));
    if (blockingIndex >= 0) {
      openRequiredStepModal(data.pasos[blockingIndex]);
      onIndexChange(blockingIndex);
      return;
    }
    onIndexChange(targetIndex);
  };

  const goNext = () => {
    if (step.id === "reglas_capa" && guideRulesTab === "cobro") {
      if (!rulesBaseReady) {
        openRequiredStepModal(step);
        return;
      }
      setGuideRulesTab("reglas");
      return;
    }
    if (step.id === "cxp_batch" && guideCxpTab === "manual") {
      setGuideCxpTab("batch");
      return;
    }
    if (currentStepRequiresCompletion) {
      openRequiredStepModal(step);
      return;
    }
    if (isLast) {
      onFinish();
      return;
    }
    tryGoToIndex(nextIndex);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      {gateModal ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[28px] border border-amber-500/25 bg-zinc-950 p-5 shadow-2xl shadow-black/60">
            <p className="text-[11px] uppercase tracking-[0.24em] text-amber-200">
              Avance protegido
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">
              {gateModal.title}
            </h3>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              {gateModal.body}
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setGateModal(null)}
                className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700"
              >
                Entendido
              </button>
              {gateModal.action === "save-capa" ? (
                <button
                  type="button"
                  onClick={() => {
                    setGateModal(null);
                    saveCurrentCapaStep();
                  }}
                  disabled={savingCapa || loadingCapa || hasValidationErrors(capaStepErrors)}
                  className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingCapa ? "Guardando" : "Guardar cambios"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className="max-h-[92vh] w-full max-w-[1500px] overflow-hidden rounded-[34px] border border-white/10 bg-zinc-950 shadow-[0_30px_120px_rgba(0,0,0,0.65)]">
        <div className="grid max-h-[92vh] overflow-y-auto lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="border-b border-white/8 bg-zinc-900/70 p-5 lg:border-b-0 lg:border-r lg:border-white/8">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-cyan-200">
                  Guia de arranque
                </p>
                <h3 className="mt-2 text-xl font-semibold text-white">
                  ABC operativo
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

            <div className="mt-5 rounded-2xl border border-cyan-500/15 bg-cyan-500/10 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-200">
                Avance general
              </p>
              <div className="mt-3 flex items-end justify-between">
                <span className="text-sm text-zinc-400">{data.capa.nombre}</span>
                <span className="text-2xl font-semibold text-white">{data.progreso}%</span>
              </div>
              <div className="mt-3">
                <ProgressBar value={data.progreso} />
              </div>
            </div>

            <div className="mt-5 space-y-2">
              {data.pasos.map((item, index) => {
                const active = index === currentIndex;
                const locked =
                  data.pasos
                    .slice(0, Math.max(index, 0))
                    .findIndex((candidate, candidateIndex) => !isStepReadyLocally(candidate, candidateIndex)) >= 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => tryGoToIndex(index)}
                    aria-disabled={locked}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      active
                        ? "border-cyan-500/30 bg-cyan-500/10 text-white"
                        : locked
                          ? "border-white/8 bg-zinc-950/50 text-zinc-600"
                          : "border-white/8 bg-zinc-950/70 text-zinc-400 hover:border-zinc-700 hover:text-white"
                    }`}
                  >
                    <span className="block text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                      Paso {index + 1}
                    </span>
                    <span className="mt-1 block text-sm font-medium">{item.titulo}</span>
                    <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] ${statusClasses(item.estado)}`}>
                      {locked ? "Bloqueado" : statusLabel(item.estado)}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="p-5 lg:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-200">
                  {progressLabel}
                </p>
                <h2 className="mt-2 text-3xl font-semibold text-white">{guide.abc}</h2>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs ${statusClasses(step.estado)}`}>
                {statusLabel(step.estado)} - {step.progreso}%
              </span>
            </div>

            <p className="mt-5 max-w-3xl text-base leading-7 text-zinc-300">
              {guide.objetivo}
            </p>

            <div className="mt-6 grid gap-4">
              <div className="min-w-0">
                <OnboardingStepEditor
                  step={step}
                  capaForm={capaForm}
                  dueMode={currentDueMode}
                  businessRules={data.reglas_marco ?? []}
                  suggestedRules={data.reglas_sugeridas ?? []}
                  ruleCatalogs={
                    data.catalogos_reglas ?? {
                      tipos_calculo: TIPOS_REGLA,
                      periodicidades: PERIODICIDADES,
                    }
                  }
                  ruleForm={ruleForm}
                  savingBusinessRule={savingBusinessRule}
                  deletingRuleId={deletingRuleId}
                  flushTop
                  showInlineCapaSaveAction={false}
                  rulesTab={step.id === "reglas_capa" ? guideRulesTab : undefined}
                  cxpTab={step.id === "cxp_batch" ? guideCxpTab : undefined}
                  onRulesTabChange={setGuideRulesTab}
                  onCxpTabChange={setGuideCxpTab}
                  updateCapaForm={onUpdateCapaForm}
                  updateRuleForm={onUpdateRuleForm}
                  onDueModeChange={(mode) =>
                    onUpdateCapaForm({
                      fecha_vencimiento_modo:
                        mode === "global" ? "GLOBAL" : "INDIVIDUAL",
                      dia_vencimiento_default:
                        mode === "global"
                          ? capaForm.dia_vencimiento_default || "1"
                          : "",
                    })
                  }
                  loadingCapa={loadingCapa}
                  savingCapa={savingCapa}
                  batchFile={batchFile}
                  importingBatch={importingBatch}
                  batchMessage={batchMessage}
                  batchErrorReport={batchErrorReport}
                  cxpEntities={cxpEntities}
                  cxpPrograms={cxpPrograms}
                  cxpEntityId={cxpEntityId}
                  cxpSelectedPresetKeys={cxpSelectedPresetKeys}
                  cxpPresetAmounts={cxpPresetAmounts}
                  cxpBatchFile={cxpBatchFile}
                  cxpBatchPeriod={cxpBatchPeriod}
                  cxpBatchMessage={cxpBatchMessage}
                  importingCxpBatch={importingCxpBatch}
                  cxpProgramForm={cxpProgramForm}
                  savingCxpProgram={savingCxpProgram}
                  deletingCxpProgramId={deletingCxpProgramId}
                  suggestedPendingCount={suggestedPendingCount}
                  onSaveCapa={onSaveCapa}
                  onDownloadBatchTemplate={onDownloadBatchTemplate}
                  onBatchFileChange={onBatchFileChange}
                  onImportBatch={onImportBatch}
                  onDownloadBatchErrorReport={onDownloadBatchErrorReport}
                  onCxpEntityChange={onCxpEntityChange}
                  onToggleCxpPreset={onToggleCxpPreset}
                  onCxpPresetAmountChange={onCxpPresetAmountChange}
                  onDownloadCxpBatchTemplate={onDownloadCxpBatchTemplate}
                  onCxpBatchFileChange={onCxpBatchFileChange}
                  onCxpBatchPeriodChange={onCxpBatchPeriodChange}
                  onImportCxpBatch={onImportCxpBatch}
                  onUpdateCxpProgramForm={onUpdateCxpProgramForm}
                  onCreateCxpProgramFromForm={onCreateCxpProgramFromForm}
                  onEditCxpProgram={onEditCxpProgram}
                  onCancelCxpProgramEdit={onCancelCxpProgramEdit}
                  onSaveCxpProgram={onSaveCxpProgram}
                  onRequestDeleteCxpProgram={onRequestDeleteCxpProgram}
                  onCreateBusinessRuleFromForm={onCreateBusinessRuleFromForm}
                  onSaveBusinessRule={onSaveBusinessRule}
                  onEditBusinessRule={onEditBusinessRule}
                  onCancelBusinessRuleEdit={onCancelBusinessRuleEdit}
                  onRequestDeleteBusinessRule={onRequestDeleteBusinessRule}
                  onRefresh={onRefresh}
                />
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 border-t border-white/8 pt-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onIndexChange(previousIndex)}
                  disabled={isFirst}
                  className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Anterior
                </button>
                {isCurrentStepOptional && !isLast ? (
                  <button
                    type="button"
                    onClick={goNext}
                    className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700"
                  >
                    Omitir opcional
                  </button>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {currentStepHasUnsavedCapaChanges ? (
                  <button
                    type="button"
                    onClick={saveCurrentCapaStep}
                    disabled={savingCapa || loadingCapa || hasValidationErrors(capaStepErrors)}
                    className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-5 py-2.5 text-sm font-semibold text-cyan-100 transition hover:border-cyan-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingCapa ? "Guardando" : "Guardar cambios"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={goNext}
                  aria-disabled={
                    currentStepRequiresCompletion
                  }
                  className={`rounded-2xl px-5 py-2.5 text-sm font-semibold transition ${
                    currentStepRequiresCompletion
                      ? "border border-white/10 bg-zinc-900 text-zinc-500"
                      : "bg-cyan-400 text-zinc-950 hover:bg-cyan-300"
                  }`}
                >
                  {step.id === "reglas_capa" && guideRulesTab === "cobro"
                    ? "Siguiente: 2.2"
                    : step.id === "cxp_batch" && guideCxpTab === "manual"
                      ? "Siguiente: 4.2"
                    : isLast
                      ? "Terminar guia"
                      : "Siguiente paso"}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function OnboardingStepAccordion({
  step,
  index,
  expanded,
  capaForm,
  businessRules,
  suggestedRules,
  ruleCatalogs,
  ruleForm,
  loadingCapa,
  savingCapa,
  savingBusinessRule,
  deletingRuleId,
  batchFile,
  importingBatch,
  batchMessage,
  batchErrorReport,
  cxpEntities,
  cxpPrograms,
  cxpEntityId,
  cxpSelectedPresetKeys,
  cxpPresetAmounts,
  cxpBatchFile,
  cxpBatchPeriod,
  cxpBatchMessage,
  importingCxpBatch,
  cxpProgramForm,
  savingCxpProgram,
  deletingCxpProgramId,
  suggestedPendingCount,
  onToggle,
  onSaveCapa,
  onUpdateCapaForm,
  onUpdateRuleForm,
  onSaveBusinessRule,
  onCreateBusinessRuleFromForm,
  onEditBusinessRule,
  onCancelBusinessRuleEdit,
  onRequestDeleteBusinessRule,
  onDownloadBatchTemplate,
  onBatchFileChange,
  onImportBatch,
  onDownloadBatchErrorReport,
  onCxpEntityChange,
  onToggleCxpPreset,
  onCxpPresetAmountChange,
  onDownloadCxpBatchTemplate,
  onCxpBatchFileChange,
  onCxpBatchPeriodChange,
  onImportCxpBatch,
  onUpdateCxpProgramForm,
  onCreateCxpProgramFromForm,
  onEditCxpProgram,
  onCancelCxpProgramEdit,
  onSaveCxpProgram,
  onRequestDeleteCxpProgram,
  onRefresh,
}: {
  step: OnboardingStep;
  index: number;
  expanded: boolean;
  capaForm: CapaFormState;
  businessRules: BusinessRule[];
  suggestedRules: SuggestedRule[];
  ruleCatalogs: RuleCatalogs;
  ruleForm: RuleFormState;
  loadingCapa: boolean;
  savingCapa: boolean;
  savingBusinessRule: boolean;
  deletingRuleId: number | null;
  batchFile: File | null;
  importingBatch: boolean;
  batchMessage: string;
  batchErrorReport: BatchErrorReport | null;
  cxpEntities: OnboardingEntityOption[];
  cxpPrograms: OnboardingCxpProgram[];
  cxpEntityId: string;
  cxpSelectedPresetKeys: string[];
  cxpPresetAmounts: Record<string, string>;
  cxpBatchFile: File | null;
  cxpBatchPeriod: string;
  cxpBatchMessage: string;
  importingCxpBatch: boolean;
  cxpProgramForm: CxpProgramFormState;
  savingCxpProgram: boolean;
  deletingCxpProgramId: number | null;
  suggestedPendingCount: number;
  onToggle: () => void;
  onSaveCapa: (label: string) => void;
  onUpdateCapaForm: (patch: Partial<CapaFormState>) => void;
  onUpdateRuleForm: (patch: Partial<RuleFormState>) => void;
  onSaveBusinessRule: () => Promise<RuleSaveResult>;
  onCreateBusinessRuleFromForm: (form: RuleFormState) => Promise<RuleSaveResult>;
  onEditBusinessRule: (rule: BusinessRule) => void;
  onCancelBusinessRuleEdit: () => void;
  onRequestDeleteBusinessRule: (rule: BusinessRule) => void;
  onDownloadBatchTemplate: () => void;
  onBatchFileChange: (file: File | null) => void;
  onImportBatch: () => void;
  onDownloadBatchErrorReport: () => void;
  onCxpEntityChange: (value: string) => void;
  onToggleCxpPreset: (key: string) => void;
  onCxpPresetAmountChange: (key: string, value: string) => void;
  onDownloadCxpBatchTemplate: () => void;
  onCxpBatchFileChange: (file: File | null) => void;
  onCxpBatchPeriodChange: (value: string) => void;
  onImportCxpBatch: () => void;
  onUpdateCxpProgramForm: (patch: Partial<CxpProgramFormState>) => void;
  onCreateCxpProgramFromForm: (
    form: CxpProgramFormState
  ) => Promise<CxpProgramSaveResult>;
  onEditCxpProgram: (program: OnboardingCxpProgram) => void;
  onCancelCxpProgramEdit: () => void;
  onSaveCxpProgram: () => Promise<CxpProgramSaveResult>;
  onRequestDeleteCxpProgram: (program: OnboardingCxpProgram) => void;
  onRefresh: () => void;
}) {
  const guide = GUIDE_COPY[step.id] ?? {
    abc: step.titulo,
    objetivo: step.descripcion,
    captura: step.bloqueos.length ? step.bloqueos : ["Revisa los datos de este paso."],
    resultado: step.por_que_importa,
    consejo: "Avanza cuando este paso refleje tu operacion real.",
  };

  return (
    <article
      className={`overflow-hidden rounded-[24px] border transition ${
        expanded
          ? "border-cyan-500/25 bg-zinc-950/85"
          : "border-white/8 bg-zinc-950/65 hover:border-zinc-700/80"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full gap-4 px-4 py-4 text-left lg:grid-cols-[44px_minmax(0,1fr)_180px_120px]"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10 text-sm font-semibold text-cyan-200">
          {index + 1}
        </span>

        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.22em] text-cyan-200">
              {guide.abc}
            </span>
            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] ${statusClasses(step.estado)}`}>
              {statusLabel(step.estado)}
            </span>
          </span>
          <span className="mt-1 block truncate text-lg font-semibold text-white">
            {step.titulo}
          </span>
          <span className="mt-1 line-clamp-2 text-sm leading-5 text-zinc-400">
            {step.descripcion}
          </span>
        </span>

        <span className="rounded-2xl border border-white/8 bg-zinc-900/70 p-3">
          <span className="flex items-center justify-between gap-3">
            <span className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">
              Avance
            </span>
            <span className="text-sm font-semibold text-white">{step.progreso}%</span>
          </span>
          <span className="mt-2 block">
            <ProgressBar value={step.progreso} />
          </span>
        </span>

        <span className="flex items-center justify-end gap-2 text-sm text-cyan-100">
          {expanded ? "Contraer" : "Editar"}
          <span className="text-lg leading-none">{expanded ? "-" : "+"}</span>
        </span>
      </button>

      {expanded ? (
        <div className="border-t border-white/8 px-4 pb-5">
          <div className="grid gap-4 pt-4">
            <div>
              <p className="text-sm leading-6 text-zinc-300">{guide.objetivo}</p>

              <OnboardingStepEditor
                step={step}
                capaForm={capaForm}
                dueMode={
                  capaForm.fecha_vencimiento_modo === "INDIVIDUAL"
                    ? "individual"
                    : "global"
                }
                businessRules={businessRules}
                suggestedRules={suggestedRules}
                ruleCatalogs={ruleCatalogs}
                ruleForm={ruleForm}
                savingBusinessRule={savingBusinessRule}
                deletingRuleId={deletingRuleId}
                updateCapaForm={onUpdateCapaForm}
                updateRuleForm={onUpdateRuleForm}
                onDueModeChange={(mode) =>
                  onUpdateCapaForm({
                    fecha_vencimiento_modo:
                      mode === "global" ? "GLOBAL" : "INDIVIDUAL",
                    dia_vencimiento_default:
                      mode === "global"
                        ? capaForm.dia_vencimiento_default || "1"
                        : "",
                  })
                }
                loadingCapa={loadingCapa}
                savingCapa={savingCapa}
                batchFile={batchFile}
                importingBatch={importingBatch}
                batchMessage={batchMessage}
                batchErrorReport={batchErrorReport}
                cxpEntities={cxpEntities}
                cxpPrograms={cxpPrograms}
                cxpEntityId={cxpEntityId}
                cxpSelectedPresetKeys={cxpSelectedPresetKeys}
                cxpPresetAmounts={cxpPresetAmounts}
                cxpBatchFile={cxpBatchFile}
                cxpBatchPeriod={cxpBatchPeriod}
                cxpBatchMessage={cxpBatchMessage}
                importingCxpBatch={importingCxpBatch}
                cxpProgramForm={cxpProgramForm}
                savingCxpProgram={savingCxpProgram}
                deletingCxpProgramId={deletingCxpProgramId}
                suggestedPendingCount={suggestedPendingCount}
                onSaveCapa={onSaveCapa}
                onDownloadBatchTemplate={onDownloadBatchTemplate}
                onBatchFileChange={onBatchFileChange}
                onImportBatch={onImportBatch}
                onDownloadBatchErrorReport={onDownloadBatchErrorReport}
                onCxpEntityChange={onCxpEntityChange}
                onToggleCxpPreset={onToggleCxpPreset}
                onCxpPresetAmountChange={onCxpPresetAmountChange}
                onDownloadCxpBatchTemplate={onDownloadCxpBatchTemplate}
                onCxpBatchFileChange={onCxpBatchFileChange}
                onCxpBatchPeriodChange={onCxpBatchPeriodChange}
                onImportCxpBatch={onImportCxpBatch}
                onUpdateCxpProgramForm={onUpdateCxpProgramForm}
                onCreateCxpProgramFromForm={onCreateCxpProgramFromForm}
                onEditCxpProgram={onEditCxpProgram}
                onCancelCxpProgramEdit={onCancelCxpProgramEdit}
                onSaveCxpProgram={onSaveCxpProgram}
                onRequestDeleteCxpProgram={onRequestDeleteCxpProgram}
                onCreateBusinessRuleFromForm={onCreateBusinessRuleFromForm}
                onSaveBusinessRule={onSaveBusinessRule}
                onEditBusinessRule={onEditBusinessRule}
                onCancelBusinessRuleEdit={onCancelBusinessRuleEdit}
                onRequestDeleteBusinessRule={onRequestDeleteBusinessRule}
                onRefresh={onRefresh}
              />

              {step.metricas.length ? (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {step.metricas.map((metric) => (
                    <div
                      key={`${step.id}-${metric.label}`}
                      className="rounded-2xl border border-white/8 bg-zinc-900/50 p-3"
                    >
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                        {metric.label}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {metric.value}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function taskToneClass(tone: DashboardTask["tone"]) {
  if (tone === "red") {
    return "border-rose-500/25 bg-rose-500/10";
  }
  if (tone === "violet") {
    return "border-violet-500/25 bg-violet-500/10";
  }
  if (tone === "amber") {
    return "border-amber-500/25 bg-amber-500/10";
  }
  if (tone === "emerald") {
    return "border-emerald-500/25 bg-emerald-500/10";
  }
  return "border-cyan-500/25 bg-cyan-500/10";
}

function TaskCenterPanel({
  tasks,
  isLoading,
  onRefresh,
}: {
  tasks: DashboardTask[];
  isLoading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-[34px] border border-white/8 bg-zinc-950/80">
      <div className="border-b border-white/8 p-5 lg:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs uppercase tracking-[0.32em] text-cyan-200">
              Centro de tareas
            </span>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white md:text-3xl">
              Accesos operativos por prioridad.
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
              Usa esta lista para resolver pendientes concretos. Cuando el modulo quede
              en orden, el boton desaparece y el dashboard conserva solo los datos duros.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="w-fit rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700"
          >
            {isLoading ? "Actualizando..." : "Actualizar tareas"}
          </button>
        </div>
      </div>

      {tasks.length ? (
        <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4 lg:p-6">
          {tasks.map((task) => (
            <Link
              key={task.id}
              href={task.href}
              className={`group rounded-3xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                task.priority === "Critica" ? "animate-pulse" : ""
              } ${taskToneClass(task.tone)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/10 text-sm font-semibold text-cyan-100">
                    {task.order}
                  </span>
                  <h3 className="mt-3 text-base font-semibold text-white">
                    {task.actionLabel}
                  </h3>
                </div>
                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-300">
                  {task.priority}
                </span>
              </div>
              <p className="mt-3 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                {task.module} | {task.badge}
              </p>
              <p className="mt-2 min-h-10 text-xs leading-relaxed text-zinc-400">
                {task.summary}
              </p>
              <span className="mt-4 inline-flex rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100 transition-colors group-hover:bg-cyan-500/20">
                Ir al modulo
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="p-5 lg:p-6">
          <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">
            No hay tareas criticas con la lectura actual. Manten la revision diaria y
            valida que los datos esten actualizados.
          </div>
        </div>
      )}
    </section>
  );
}

export default function OnboardingWorkspace() {
  const [data, setData] = useState<OnboardingPayload | null>(null);
  const [capaForm, setCapaForm] = useState<CapaFormState>(EMPTY_CAPA_FORM);
  const [savedCapaForm, setSavedCapaForm] =
    useState<CapaFormState>(EMPTY_CAPA_FORM);
  const [loading, setLoading] = useState(true);
  const [loadingCapa, setLoadingCapa] = useState(false);
  const [ruleForm, setRuleForm] = useState<RuleFormState>(EMPTY_RULE_FORM);
  const [savingBusinessRule, setSavingBusinessRule] = useState(false);
  const [deletingRuleId, setDeletingRuleId] = useState<number | null>(null);
  const [rulePendingDelete, setRulePendingDelete] =
    useState<BusinessRule | null>(null);
  const [savingCapa, setSavingCapa] = useState(false);
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [importingBatch, setImportingBatch] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const [batchErrorReport, setBatchErrorReport] = useState<BatchErrorReport | null>(
    null
  );
  const [cxpEntityId, setCxpEntityId] = useState("");
  const [cxpSelectedPresetKeys, setCxpSelectedPresetKeys] = useState<string[]>([]);
  const [cxpPresetAmounts, setCxpPresetAmounts] = useState<Record<string, string>>(
    () =>
      CXP_FIXED_PAYMENT_PRESETS.reduce<Record<string, string>>((acc, preset) => {
        acc[preset.key] = "0";
        return acc;
      }, {})
  );
  const [cxpBatchFile, setCxpBatchFile] = useState<File | null>(null);
  const [cxpBatchPeriod, setCxpBatchPeriod] = useState(monthIso());
  const [cxpBatchMessage, setCxpBatchMessage] = useState("");
  const [importingCxpBatch, setImportingCxpBatch] = useState(false);
  const [cxpProgramForm, setCxpProgramForm] =
    useState<CxpProgramFormState>(EMPTY_CXP_PROGRAM_FORM);
  const [savingCxpProgram, setSavingCxpProgram] = useState(false);
  const [deletingCxpProgramId, setDeletingCxpProgramId] = useState<number | null>(
    null
  );
  const [cxpProgramPendingDelete, setCxpProgramPendingDelete] =
    useState<OnboardingCxpProgram | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideIndex, setGuideIndex] = useState(0);
  const [expandedStepId, setExpandedStepId] = useState("");
  const [activeOnboardingSection, setActiveOnboardingSection] =
    useState<"primeros" | "tareas">("primeros");
  const [taskCenterItems, setTaskCenterItems] = useState<DashboardTask[]>([]);
  const [loadingTaskCenter, setLoadingTaskCenter] = useState(false);
  const [taskCenterLoaded, setTaskCenterLoaded] = useState(false);
  const [autoExpandedCapaId, setAutoExpandedCapaId] = useState<number | null>(
    null
  );

  const loadCapaConfig = useCallback(async (capaId: number) => {
    setLoadingCapa(true);
    try {
      const response = await fetch(`${CAPAS_API_BASE}/${capaId}/`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("No se pudo cargar la capa.");
      }
      const payload = (await response.json()) as CapaConfig;
      const nextForm = mapCapaToForm(payload);
      setCapaForm(nextForm);
      setSavedCapaForm(nextForm);
    } catch {
      setError("No se pudieron cargar los campos editables del onboarding.");
    } finally {
      setLoadingCapa(false);
    }
  }, []);

  const loadOnboarding = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(ONBOARDING_API, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("No se pudo cargar el onboarding.");
      }
      const payload = (await response.json()) as OnboardingPayload;
      setData(payload);
    } catch {
      setError("No se pudo cargar el onboarding guiado.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTaskCenter = useCallback(async () => {
    setLoadingTaskCenter(true);
    try {
      const response = await fetch(ONBOARDING_TASKS_API, { cache: "no-store" });

      if (!response.ok) {
        throw new Error("No se pudo cargar el centro de tareas.");
      }

      const taskPayload = (await response.json()) as TaskCenterResponse;
      const cxcMetrics = taskPayload.cxc;
      const cxpMetrics = taskPayload.cxp;
      const rentMetrics = taskPayload.renta;
      const tasks: DashboardTask[] = [];

      if ((cxcMetrics.vencidas_count || 0) > 0) {
        tasks.push({
          id: "cxc-vencida",
          order: 1,
          module: "CxC",
          summary: `${cxcMetrics.vencidas_count || 0} cuentas vencidas. Revisa cartera, saldos y antiguedad.`,
          badge: formatCurrency(cxcMetrics.vencidas_total || 0),
          priority: "Critica",
          href: "/cxc",
          actionLabel: "Abrir CxC",
          tone: "red",
        });
      }

      if ((cxpMetrics.vencido || 0) + (cxpMetrics.por_conciliar || 0) > 0) {
        const isCritical = (cxpMetrics.vencido || 0) > 0;
        tasks.push({
          id: "cxp-pendiente",
          order: 2,
          module: "CxP",
          summary: `${cxpMetrics.vencidos_count || 0} vencidos y ${cxpMetrics.por_conciliar_count || 0} por conciliar.`,
          badge: formatCurrency(
            (cxpMetrics.vencido || 0) + (cxpMetrics.por_conciliar || 0)
          ),
          priority: isCritical ? "Critica" : "Alta",
          href: "/cxp",
          actionLabel: "Abrir CxP",
          tone: "violet",
        });
      }

      if ((cxcMetrics.vencidas_count || 0) + (cxcMetrics.por_vencer_count || 0) > 0) {
        tasks.push({
          id: "cobranza-seguimiento",
          order: 3,
          module: "Cobranza",
          summary: `${cxcMetrics.vencidas_count || 0} vencidas y ${cxcMetrics.por_vencer_count || 0} por vencer este mes. Revisa mensajes y seguimiento.`,
          badge: formatCurrency(
            (cxcMetrics.vencidas_total || 0) + (cxcMetrics.por_vencer_total || 0)
          ),
          priority: (cxcMetrics.vencidas_count || 0) > 0 ? "Critica" : "Alta",
          href: "/cobranza",
          actionLabel: "Abrir cobranza",
          tone: "amber",
        });
      }

      if ((rentMetrics.espacios_disponibles || 0) > 0) {
        tasks.push({
          id: "renta-vacante",
          order: 4,
          module: "Renta",
          summary: `${rentMetrics.espacios_disponibles || 0} espacios disponibles. Revisa inventario, publicaciones y captura comercial.`,
          badge: formatCurrency(rentMetrics.renta_vacante_estimada || 0),
          priority: (rentMetrics.renta_vacante_estimada || 0) > 0 ? "Alta" : "Media",
          href: "/renta-espacios",
          actionLabel: "Abrir renta",
          tone: "emerald",
        });
      }

      setTaskCenterItems(tasks.sort((left, right) => left.order - right.order));
      setTaskCenterLoaded(true);
    } catch {
      setTaskCenterItems([]);
      setTaskCenterLoaded(true);
    } finally {
      setLoadingTaskCenter(false);
    }
  }, []);

  useEffect(() => {
    void loadOnboarding();
  }, [loadOnboarding]);

  useEffect(() => {
    if (activeOnboardingSection === "tareas" && !taskCenterLoaded && !loadingTaskCenter) {
      void loadTaskCenter();
    }
  }, [
    activeOnboardingSection,
    loadTaskCenter,
    loadingTaskCenter,
    taskCenterLoaded,
  ]);

  useEffect(() => {
    if (data?.capa_config) {
      const nextForm = mapCapaToForm(data.capa_config);
      setCapaForm(nextForm);
      setSavedCapaForm(nextForm);
      return;
    }
    if (data?.capa.id) {
      void loadCapaConfig(data.capa.id);
    }
  }, [data?.capa.id, data?.capa_config, loadCapaConfig]);

  useEffect(() => {
    if (!data?.cxp_entidades?.length) {
      setCxpEntityId("");
      return;
    }
    setCxpEntityId((current) => {
      if (current && data.cxp_entidades?.some((entity) => String(entity.id) === current)) {
        return current;
      }
      return String(data.cxp_entidades?.[0]?.id || "");
    });
  }, [data?.cxp_entidades]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const firstPendingIndex = data.pasos.findIndex((step) => step.estado !== "COMPLETO");
    const nextIndex = firstPendingIndex >= 0 ? firstPendingIndex : 0;
    const nextStepId = data.pasos[nextIndex]?.id;
    if (autoExpandedCapaId !== data.capa.id && nextStepId) {
      setExpandedStepId(nextStepId);
      setAutoExpandedCapaId(data.capa.id);
    }
    setGuideIndex((current) => (current >= data.pasos.length ? nextIndex : current));
  }, [autoExpandedCapaId, data]);

  const updateCapaForm = (patch: Partial<CapaFormState>) => {
    setCapaForm((current) => ({ ...current, ...patch }));
  };

  const selectBatchFile = (file: File | null) => {
    setBatchFile(file);
    setBatchErrorReport(null);
    if (file) {
      setBatchMessage("");
    }
  };

  const updateRuleForm = (patch: Partial<RuleFormState>) => {
    setRuleForm((current) => ({ ...current, ...patch }));
  };

  const updateCxpProgramForm = (patch: Partial<CxpProgramFormState>) => {
    setCxpProgramForm((current) => ({ ...current, ...patch }));
  };

  const suggestedPending = useMemo(() => {
    return data?.reglas_sugeridas.filter((rule) => !rule.ya_existe) ?? [];
  }, [data]);

  const businessRules = useMemo(() => data?.reglas_marco ?? [], [data]);

  const ruleCatalogs = useMemo<RuleCatalogs>(
    () =>
      data?.catalogos_reglas ?? {
        tipos_calculo: TIPOS_REGLA,
        periodicidades: PERIODICIDADES,
      },
    [data]
  );
  const capaFormHasUnsavedChanges = useMemo(
    () => JSON.stringify(capaForm) !== JSON.stringify(savedCapaForm),
    [capaForm, savedCapaForm]
  );

  const persistBusinessRuleForm = async (
    form: RuleFormState,
    options: { resetForm?: boolean; quiet?: boolean } = {}
  ): Promise<RuleSaveResult> => {
    const validationErrors = validateBusinessRuleForm(form);
    if (hasValidationErrors(validationErrors)) {
      const message =
        Object.values(validationErrors).find(Boolean) || "Revisa los campos de la regla.";
      setError(message);
      return { ok: false, error: message };
    }
    const payload = buildRulePayload(form);
    if (!payload.nombre) {
      const message = "La regla necesita un nombre.";
      setError(message);
      return { ok: false, error: message };
    }

    setSavingBusinessRule(true);
    setNotice("");
    setError("");
    try {
      const endpoint = form.id
        ? `${ONBOARDING_API}reglas/${form.id}/`
        : `${ONBOARDING_API}reglas/`;
      const response = await fetch(endpoint, {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.detail || "No se pudo guardar la regla.");
      }
      const result = await response.json();
      setData(result.onboarding as OnboardingPayload);
      if (options.resetForm) {
        setRuleForm(EMPTY_RULE_FORM);
      }
      if (!options.quiet) {
        setNotice(form.id ? "Regla heredable actualizada." : "Regla heredable creada.");
      }
      return { ok: true };
    } catch (exc) {
      const message =
        exc instanceof Error
          ? exc.message
          : "No se pudo guardar la regla heredable.";
      setError(message);
      return { ok: false, error: message };
    } finally {
      setSavingBusinessRule(false);
    }
  };

  const saveBusinessRule = async () => {
    return persistBusinessRuleForm(ruleForm, { resetForm: true });
  };

  const createBusinessRuleFromForm = async (form: RuleFormState) => {
    return persistBusinessRuleForm({ ...form, id: null }, { quiet: true });
  };

  const confirmDeleteBusinessRule = async () => {
    if (!rulePendingDelete) {
      return;
    }

    setDeletingRuleId(rulePendingDelete.id);
    setNotice("");
    setError("");
    try {
      const response = await fetch(
        `${ONBOARDING_API}reglas/${rulePendingDelete.id}/`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.detail || "No se pudo eliminar la regla.");
      }
      const result = await response.json();
      setData(result.onboarding as OnboardingPayload);
      if (ruleForm.id === rulePendingDelete.id) {
        setRuleForm(EMPTY_RULE_FORM);
      }
      setRulePendingDelete(null);
      setNotice("Regla heredable eliminada.");
    } catch (exc) {
      setError(
        exc instanceof Error
          ? exc.message
          : "No se pudo eliminar la regla heredable."
      );
    } finally {
      setDeletingRuleId(null);
    }
  };

  const saveCapaForm = async (successMessage: string) => {
    if (!data) {
      return;
    }

    setSavingCapa(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch(`${CAPAS_API_BASE}/${data.capa.id}/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayloadFromForm(capaForm)),
      });
      if (!response.ok) {
        throw new Error("No se pudo guardar la capa.");
      }
      setNotice(successMessage);
      await loadOnboarding();
      await loadCapaConfig(data.capa.id);
    } catch {
      setError("No se pudieron guardar los cambios del onboarding.");
    } finally {
      setSavingCapa(false);
    }
  };

  const downloadBatchTemplate = async () => {
    setNotice("");
    setError("");
    try {
      const response = await fetch(BATCH_TEMPLATE_API);
      if (!response.ok) {
        throw new Error("No se pudo descargar la plantilla.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = extractFilename(
        response.headers.get("content-disposition"),
        "plantilla-entidades-espacios.xlsx"
      );
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("No se pudo descargar la plantilla batch.");
    }
  };

  const downloadBatchErrorReport = () => {
    if (!batchErrorReport) {
      return;
    }

    try {
      const binary = window.atob(batchErrorReport.contentBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = batchErrorReport.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError("No se pudo descargar el archivo de errores.");
    }
  };

  const importBatch = async () => {
    if (!batchFile) {
      setError("Selecciona el archivo batch que quieres importar.");
      return;
    }

    setImportingBatch(true);
    setBatchMessage("");
    setBatchErrorReport(null);
    setNotice("");
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", batchFile);
      const response = await fetch(BATCH_IMPORT_API, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const body = await readResponseBody(response);
        throw new Error(getErrorMessage(body, "No se pudo importar el archivo."));
      }
      const payload = (await response.json()) as {
        entidades_creadas?: number;
        espacios_creados?: number;
        clientes_creados?: number;
        cxc_creadas?: number;
        filas_omitidas?: number;
        errores_total?: number;
        archivo_errores_nombre?: string;
        archivo_errores_base64?: string;
      };
      const omittedRows = payload.filas_omitidas ?? 0;
      const message = `Carga lista: ${payload.entidades_creadas ?? 0} unidades, ${
        payload.espacios_creados ?? 0
      } espacios, ${payload.clientes_creados ?? 0} clientes y ${
        payload.cxc_creadas ?? 0
      } CxC nuevas.${
        omittedRows
          ? ` ${omittedRows} fila(s) no se procesaron; descarga el archivo de errores, corrige y vuelve a subir.`
          : ""
      }`;
      if (payload.archivo_errores_base64) {
        setBatchErrorReport({
          filename: payload.archivo_errores_nombre || "errores-importacion-batch.xlsx",
          contentBase64: payload.archivo_errores_base64,
          rows: payload.errores_total ?? omittedRows,
        });
      }
      setBatchMessage(message);
      setNotice(
        omittedRows
          ? "Carga parcial completada. Revisa el archivo de errores para terminar la migracion."
          : message
      );
      setBatchFile(null);
      await loadOnboarding();
    } catch (exc) {
      setError(
        exc instanceof Error
          ? exc.message
          : "No se pudo importar la carga batch. Revisa la plantilla y vuelve a intentar."
      );
    } finally {
      setImportingBatch(false);
    }
  };

  const toggleCxpPreset = (key: string) => {
    setCxpSelectedPresetKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    );
  };

  const updateCxpPresetAmount = (key: string, value: string) => {
    setCxpPresetAmounts((current) => ({ ...current, [key]: sanitizeMoneyInput(value) }));
  };

  const downloadCxpBatchTemplate = async () => {
    setNotice("");
    setError("");
    try {
      const response = await fetch(CXP_BATCH_TEMPLATE_API);
      if (!response.ok) {
        const body = await readResponseBody(response);
        throw new Error(getErrorMessage(body, "No se pudo descargar la plantilla CxP."));
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = extractFilename(
        response.headers.get("content-disposition"),
        "plantilla-cuentas-por-pagar.csv"
      );
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (exc) {
      setError(
        exc instanceof Error
          ? exc.message
          : "No se pudo descargar la plantilla de cuentas por pagar."
      );
    }
  };

  const importCxpBatch = async () => {
    if (!cxpBatchFile) {
      setError("Selecciona el archivo CxP que quieres importar.");
      return;
    }
    if (!cxpBatchPeriod) {
      setError("Selecciona el periodo de la carga CxP.");
      return;
    }
    setImportingCxpBatch(true);
    setCxpBatchMessage("");
    setNotice("");
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", cxpBatchFile);
      formData.append("periodo", cxpBatchPeriod);
      const response = await fetch(CXP_BATCH_IMPORT_API, {
        method: "POST",
        body: formData,
      });
      const body = await readResponseBody(response);
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo importar la carga batch de CxP.")
        );
      }
      const payload = body as {
        creados?: number;
        existentes?: number;
        omitidos?: number;
        mensaje?: string;
      };
      const message = `CxP lista: ${payload.creados ?? 0} creadas, ${
        payload.existentes ?? 0
      } ya existentes y ${payload.omitidos ?? 0} omitidas.`;
      setCxpBatchMessage(payload.mensaje || message);
      setNotice(payload.mensaje || message);
      setCxpBatchFile(null);
      await loadOnboarding();
    } catch (exc) {
      setError(
        exc instanceof Error
          ? exc.message
          : "No se pudo importar la carga batch de CxP."
      );
    } finally {
      setImportingCxpBatch(false);
    }
  };

  const editCxpProgram = (program: OnboardingCxpProgram) => {
    setCxpEntityId(String(program.entidad_id));
    setCxpProgramForm(mapCxpProgramToForm(program));
    setNotice("");
    setError("");
  };

  const cancelCxpProgramEdit = () => {
    setCxpProgramForm(EMPTY_CXP_PROGRAM_FORM);
  };

  const persistCxpProgramForm = async (
    form: CxpProgramFormState,
    options: { resetForm?: boolean; quiet?: boolean } = {}
  ): Promise<CxpProgramSaveResult> => {
    const validationErrors = validateCxpProgramForm(form);
    if (hasValidationErrors(validationErrors)) {
      const message =
        Object.values(validationErrors).find(Boolean) ||
        "Revisa los campos del gasto fijo.";
      setError(message);
      return { ok: false, error: message };
    }
    const payload = buildCxpProgramPayload(form);
    if (!payload.nombre) {
      const message = "El gasto fijo necesita un nombre.";
      setError(message);
      return { ok: false, error: message };
    }
    if (!payload.proveedor_nombre) {
      const message = "El gasto fijo necesita proveedor.";
      setError(message);
      return { ok: false, error: message };
    }
    if (payload.monto_base <= 0) {
      const message = "El monto base debe ser mayor a 0.";
      setError(message);
      return { ok: false, error: message };
    }
    const targetEntityId = form.entidad_id || cxpEntityId;
    if (!form.id && !targetEntityId) {
      const message = "Selecciona una unidad de negocio para crear el gasto fijo.";
      setError(message);
      return { ok: false, error: message };
    }

    setSavingCxpProgram(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch(
        form.id
          ? `${FINANZAS_API_BASE}/cxp/programaciones/${form.id}/`
          : `${FINANZAS_API_BASE}/entidades/${targetEntityId}/cxp/programaciones/`,
        {
          method: form.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await readResponseBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo guardar el gasto fijo."));
      }
      if (!options.quiet) {
        setNotice(form.id ? "Gasto fijo actualizado." : "Gasto fijo creado.");
      }
      if (!form.id && targetEntityId) {
        setCxpEntityId(targetEntityId);
      }
      if (options.resetForm) {
        setCxpProgramForm(EMPTY_CXP_PROGRAM_FORM);
      }
      await loadOnboarding();
      return { ok: true };
    } catch (exc) {
      const message =
        exc instanceof Error ? exc.message : "No se pudo guardar el gasto fijo.";
      setError(message);
      return { ok: false, error: message };
    } finally {
      setSavingCxpProgram(false);
    }
  };

  const saveCxpProgram = async () => {
    return persistCxpProgramForm(cxpProgramForm, { resetForm: true });
  };

  const createCxpProgramFromForm = async (form: CxpProgramFormState) => {
    return persistCxpProgramForm({ ...form, id: null }, { quiet: true });
  };

  const confirmDeleteCxpProgram = async () => {
    if (!cxpProgramPendingDelete) {
      return;
    }

    setDeletingCxpProgramId(cxpProgramPendingDelete.id);
    setNotice("");
    setError("");
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/cxp/programaciones/${cxpProgramPendingDelete.id}/`,
        { method: "DELETE" }
      );
      const body = await readResponseBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo borrar el gasto fijo."));
      }
      if (cxpProgramForm.id === cxpProgramPendingDelete.id) {
        setCxpProgramForm(EMPTY_CXP_PROGRAM_FORM);
      }
      setCxpProgramPendingDelete(null);
      setNotice("Gasto fijo eliminado.");
      await loadOnboarding();
    } catch (exc) {
      setError(
        exc instanceof Error ? exc.message : "No se pudo borrar el gasto fijo."
      );
    } finally {
      setDeletingCxpProgramId(null);
    }
  };

  const openStepGuide = () => {
    if (!data) {
      return;
    }
    const firstPendingIndex = data.pasos.findIndex((step) => step.estado !== "COMPLETO");
    setGuideIndex(firstPendingIndex >= 0 ? firstPendingIndex : 0);
    setGuideOpen(true);
  };

  const finishGuide = () => {
    if (data && typeof window !== "undefined") {
      window.localStorage.setItem(`${GUIDE_STORAGE_PREFIX}-${data.capa.id}`, "1");
    }
    setGuideOpen(false);
  };

  if (loading) {
    return <Skeleton />;
  }

  if (!data) {
    return (
      <section className="rounded-[32px] border border-rose-500/20 bg-rose-500/10 p-6 text-rose-100">
        {error || "No hay informacion de onboarding disponible."}
      </section>
    );
  }

  return (
    <main className="space-y-5">
      {importingBatch ? <BatchImportLoadingOverlay /> : null}
      {rulePendingDelete ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[30px] border border-rose-500/20 bg-zinc-950 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.6)]">
            <p className="text-xs uppercase tracking-[0.28em] text-rose-200">
              Confirmar eliminacion
            </p>
            <h3 className="mt-3 text-2xl font-semibold text-white">
              Eliminar regla heredable
            </h3>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              Esta regla dejara de heredarse a nuevas unidades y ya no aparecera
              como plantilla operativa. No se eliminaran cargos historicos ya creados.
            </p>
            <div className="mt-5 rounded-2xl border border-white/8 bg-zinc-900/70 p-4">
              <p className="text-lg font-semibold text-white">
                {rulePendingDelete.nombre}
              </p>
              <p className="mt-1 text-sm text-zinc-400">
                {rulePendingDelete.tipo_calculo_label || rulePendingDelete.tipo_calculo} -{" "}
                {businessRuleValueLabel(rulePendingDelete)}
              </p>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setRulePendingDelete(null)}
                disabled={deletingRuleId !== null}
                className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDeleteBusinessRule}
                disabled={deletingRuleId !== null}
                className="rounded-2xl border border-rose-500/30 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:border-rose-400/60 disabled:opacity-50"
              >
                {deletingRuleId !== null ? "Eliminando" : "Eliminar regla"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cxpProgramPendingDelete ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-[30px] border border-rose-500/20 bg-zinc-950 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.6)]">
            <p className="text-xs uppercase tracking-[0.28em] text-rose-200">
              Confirmar eliminacion
            </p>
            <h3 className="mt-3 text-2xl font-semibold text-white">
              Borrar gasto fijo aplicado
            </h3>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              Se eliminara la programacion recurrente. No se borran pagos o CxP
              historicas que ya se hayan generado.
            </p>
            <div className="mt-5 rounded-2xl border border-white/8 bg-zinc-900/70 p-4">
              <p className="text-lg font-semibold text-white">
                {cxpProgramPendingDelete.nombre}
              </p>
              <p className="mt-1 text-sm text-zinc-400">
                {cxpProgramPendingDelete.entidad_nombre} -{" "}
                {formatCurrency(cxpProgramPendingDelete.monto_base)}
              </p>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setCxpProgramPendingDelete(null)}
                disabled={deletingCxpProgramId !== null}
                className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDeleteCxpProgram}
                disabled={deletingCxpProgramId !== null}
                className="rounded-2xl border border-rose-500/30 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:border-rose-400/60 disabled:opacity-50"
              >
                {deletingCxpProgramId !== null ? "Borrando" : "Borrar gasto"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <OnboardingGuideModal
        data={data}
        open={guideOpen}
        currentIndex={guideIndex}
        capaForm={capaForm}
        ruleForm={ruleForm}
        savingBusinessRule={savingBusinessRule}
        deletingRuleId={deletingRuleId}
        loadingCapa={loadingCapa}
        savingCapa={savingCapa}
        batchFile={batchFile}
        importingBatch={importingBatch}
        batchMessage={batchMessage}
        batchErrorReport={batchErrorReport}
        cxpEntities={data.cxp_entidades ?? []}
        cxpPrograms={data.cxp_programaciones ?? []}
        cxpEntityId={cxpEntityId}
        cxpSelectedPresetKeys={cxpSelectedPresetKeys}
        cxpPresetAmounts={cxpPresetAmounts}
        cxpBatchFile={cxpBatchFile}
        cxpBatchPeriod={cxpBatchPeriod}
        cxpBatchMessage={cxpBatchMessage}
        importingCxpBatch={importingCxpBatch}
        cxpProgramForm={cxpProgramForm}
        savingCxpProgram={savingCxpProgram}
        deletingCxpProgramId={deletingCxpProgramId}
        suggestedPendingCount={suggestedPending.length}
        hasUnsavedCapaChanges={capaFormHasUnsavedChanges}
        onClose={() => setGuideOpen(false)}
        onIndexChange={setGuideIndex}
        onSaveCapa={saveCapaForm}
        onUpdateCapaForm={updateCapaForm}
        onUpdateRuleForm={updateRuleForm}
        onSaveBusinessRule={saveBusinessRule}
        onCreateBusinessRuleFromForm={createBusinessRuleFromForm}
        onEditBusinessRule={(rule) => setRuleForm(mapRuleToForm(rule))}
        onCancelBusinessRuleEdit={() => setRuleForm(EMPTY_RULE_FORM)}
        onRequestDeleteBusinessRule={setRulePendingDelete}
        onDownloadBatchTemplate={downloadBatchTemplate}
        onBatchFileChange={selectBatchFile}
        onImportBatch={importBatch}
        onDownloadBatchErrorReport={downloadBatchErrorReport}
        onCxpEntityChange={setCxpEntityId}
        onToggleCxpPreset={toggleCxpPreset}
        onCxpPresetAmountChange={updateCxpPresetAmount}
        onDownloadCxpBatchTemplate={downloadCxpBatchTemplate}
        onCxpBatchFileChange={setCxpBatchFile}
        onCxpBatchPeriodChange={setCxpBatchPeriod}
        onImportCxpBatch={importCxpBatch}
        onUpdateCxpProgramForm={updateCxpProgramForm}
        onCreateCxpProgramFromForm={createCxpProgramFromForm}
        onEditCxpProgram={editCxpProgram}
        onCancelCxpProgramEdit={cancelCxpProgramEdit}
        onSaveCxpProgram={saveCxpProgram}
        onRequestDeleteCxpProgram={setCxpProgramPendingDelete}
        onRefresh={() => void loadOnboarding()}
        onFinish={finishGuide}
      />

      <section className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-[28px] border border-white/8 bg-zinc-950/80 p-3 lg:sticky lg:top-4 lg:h-fit">
          {[
            {
              id: "primeros" as const,
              number: "1",
              title: "Primeros pasos",
              description: "Configura la base operativa.",
            },
            {
              id: "tareas" as const,
              number: "2",
              title: "Centro de tareas",
              description: taskCenterLoaded
                ? `${taskCenterItems.length} pendientes activos.`
                : "Carga al abrir.",
            },
          ].map((item) => {
            const isActive = activeOnboardingSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveOnboardingSection(item.id)}
                className={`mb-2 w-full rounded-2xl border px-3 py-3 text-left transition ${
                  isActive
                    ? "border-cyan-500/40 bg-cyan-500/15 text-white"
                    : "border-white/8 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700"
                }`}
              >
                <span className="text-[10px] uppercase tracking-[0.22em] text-cyan-200">
                  Punto {item.number}
                </span>
                <span className="mt-1 block text-sm font-semibold">{item.title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-zinc-500">
                  {item.description}
                </span>
              </button>
            );
          })}
        </aside>

        <div className="space-y-5">
          {activeOnboardingSection === "primeros" ? (
            <>

      <section className="overflow-hidden rounded-[34px] border border-white/8 bg-zinc-950/80">
        <div className="grid gap-5 p-5 lg:grid-cols-[1.4fr_0.6fr] lg:p-6">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs uppercase tracking-[0.32em] text-cyan-200">
                Primeros pasos
              </span>
              <span className={`rounded-full border px-3 py-1 text-xs ${statusClasses(data.estado)}`}>
                {statusLabel(data.estado)}
              </span>
            </div>

            <h2 className="mt-4 max-w-4xl text-2xl font-semibold tracking-tight text-white md:text-3xl">
              Arranque guiado sin salir del flujo.
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
              Configura primero la capa de negocio y sus reglas. Esa base se hereda a
              unidades, clientes, cartera, portal y cobranza. Abre cada paso, llena los
              campos y guarda sin cambiar de pantalla.
            </p>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={openStepGuide}
                className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300"
              >
                Iniciar guia paso a paso
              </button>
              <button
                type="button"
                onClick={() => void loadOnboarding()}
                className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-700"
              >
                Actualizar avance
              </button>
              <button
                type="button"
                onClick={() => {
                  const firstPending = data.pasos.find(
                    (step) => step.estado !== "COMPLETO"
                  );
                  if (firstPending) {
                    setExpandedStepId(firstPending.id);
                  }
                }}
                className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-400/60"
              >
                Abrir siguiente pendiente
              </button>
            </div>
          </div>

          <div className="rounded-[24px] border border-cyan-500/15 bg-cyan-500/10 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-200">
              Capa activa
            </p>
            <p className="mt-2 text-xl font-semibold text-white">{data.capa.nombre}</p>
            <p className="mt-1 text-sm text-zinc-400">{data.capa.tipo_capa}</p>
            <div className="mt-4">
              <div className="flex items-end justify-between gap-3">
                <p className="text-sm text-zinc-400">Avance de arranque</p>
                <p className="text-3xl font-semibold text-white">{data.progreso}%</p>
              </div>
              <div className="mt-3">
                <ProgressBar value={data.progreso} />
              </div>
            </div>
          </div>
        </div>

        {data.perfil ? (
          <div className="border-t border-white/8 bg-zinc-950/70 p-5 lg:p-6">
            <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
              <div>
                <p className="text-[11px] uppercase tracking-[0.26em] text-emerald-200">
                  Perfil por tipo de negocio
                </p>
                <h3 className="mt-2 text-xl font-semibold text-white">
                  {data.perfil.titulo}
                </h3>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {data.perfil.descripcion}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.perfil.modulos_clave.map((moduleKey) => (
                    <span
                      key={moduleKey}
                      className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-100"
                    >
                      {moduleKey.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              </div>
              <div className="grid gap-2">
                {data.perfil.prioridades.map((priority, index) => (
                  <div
                    key={priority}
                    className="flex gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-400 text-xs font-bold text-zinc-950">
                      {index + 1}
                    </span>
                    <p className="text-sm leading-6 text-zinc-300">{priority}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid border-t border-white/8 md:grid-cols-4">
          {[
            ["Unidades", data.metricas.entidades],
            ["Espacios", data.metricas.espacios],
            ["Clientes", data.metricas.clientes],
            ["CxC del mes", data.metricas.cxc_mes],
          ].map(([label, value]) => (
            <div key={label} className="border-white/8 p-4 md:border-r last:md:border-r-0">
              <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{label}</p>
              <p className="mt-1 text-xl font-semibold text-white">{value}</p>
            </div>
          ))}
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-5 py-4 text-rose-100">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-4 text-emerald-100">
          {notice}
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-cyan-200">
              Pasos de arranque
            </p>
            <h3 className="mt-1 text-xl font-semibold text-white">
              Completa cada bloque en orden operativo.
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setExpandedStepId("")}
              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700"
            >
              Contraer todo
            </button>
            <button
              type="button"
              onClick={() => setExpandedStepId(data.pasos[0]?.id || "")}
              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700"
            >
              Abrir inicio
            </button>
          </div>
        </div>

        {data.pasos.map((step, index) => (
          <OnboardingStepAccordion
            key={step.id}
            step={step}
            index={index}
            expanded={expandedStepId === step.id}
            capaForm={capaForm}
            businessRules={businessRules}
            suggestedRules={data.reglas_sugeridas ?? []}
            ruleCatalogs={ruleCatalogs}
            ruleForm={ruleForm}
            loadingCapa={loadingCapa}
            savingCapa={savingCapa}
            savingBusinessRule={savingBusinessRule}
            deletingRuleId={deletingRuleId}
            batchFile={batchFile}
            importingBatch={importingBatch}
            batchMessage={batchMessage}
            batchErrorReport={batchErrorReport}
            cxpEntities={data.cxp_entidades ?? []}
            cxpPrograms={data.cxp_programaciones ?? []}
            cxpEntityId={cxpEntityId}
            cxpSelectedPresetKeys={cxpSelectedPresetKeys}
            cxpPresetAmounts={cxpPresetAmounts}
            cxpBatchFile={cxpBatchFile}
            cxpBatchPeriod={cxpBatchPeriod}
            cxpBatchMessage={cxpBatchMessage}
            importingCxpBatch={importingCxpBatch}
            cxpProgramForm={cxpProgramForm}
            savingCxpProgram={savingCxpProgram}
            deletingCxpProgramId={deletingCxpProgramId}
            suggestedPendingCount={suggestedPending.length}
            onToggle={() =>
              setExpandedStepId((current) => (current === step.id ? "" : step.id))
            }
            onSaveCapa={saveCapaForm}
            onUpdateCapaForm={updateCapaForm}
            onUpdateRuleForm={updateRuleForm}
            onSaveBusinessRule={saveBusinessRule}
            onCreateBusinessRuleFromForm={createBusinessRuleFromForm}
            onEditBusinessRule={(rule) => setRuleForm(mapRuleToForm(rule))}
            onCancelBusinessRuleEdit={() => setRuleForm(EMPTY_RULE_FORM)}
            onRequestDeleteBusinessRule={setRulePendingDelete}
            onDownloadBatchTemplate={downloadBatchTemplate}
            onBatchFileChange={selectBatchFile}
            onImportBatch={importBatch}
            onDownloadBatchErrorReport={downloadBatchErrorReport}
            onCxpEntityChange={setCxpEntityId}
            onToggleCxpPreset={toggleCxpPreset}
            onCxpPresetAmountChange={updateCxpPresetAmount}
            onDownloadCxpBatchTemplate={downloadCxpBatchTemplate}
            onCxpBatchFileChange={setCxpBatchFile}
            onCxpBatchPeriodChange={setCxpBatchPeriod}
            onImportCxpBatch={importCxpBatch}
            onUpdateCxpProgramForm={updateCxpProgramForm}
            onCreateCxpProgramFromForm={createCxpProgramFromForm}
            onEditCxpProgram={editCxpProgram}
            onCancelCxpProgramEdit={cancelCxpProgramEdit}
            onSaveCxpProgram={saveCxpProgram}
            onRequestDeleteCxpProgram={setCxpProgramPendingDelete}
            onRefresh={() => void loadOnboarding()}
          />
        ))}
      </section>
            </>
          ) : (
            <TaskCenterPanel
              tasks={taskCenterItems}
              isLoading={loadingTaskCenter}
              onRefresh={() => {
                setTaskCenterLoaded(false);
                void loadTaskCenter();
              }}
            />
          )}
        </div>
      </section>
    </main>
  );
}
