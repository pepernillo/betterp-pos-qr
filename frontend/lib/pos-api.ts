/**
 * Cliente del API del punto de venta.
 *
 * El AuthProvider parcha `window.fetch` para inyectar el token de acceso y la
 * capa activa en las llamadas al backend, asi que aqui solo se arma la URL.
 */

import { buildApiUrl } from "./api";

export type PuntoVenta = {
  id: number;
  codigo: string;
  nombre: string;
  entidad_id: number | null;
  bodega_id: number;
  bodega_nombre: string | null;
  tipo_servicio: "MOSTRADOR" | "RESTAURANTE";
  es_restaurante: boolean;
  acepta_cobro_qr: boolean;
  menu_qr_activo: boolean;
  menu_token: string;
  moneda: string;
  porcentaje_propina_sugerido: string;
  activo: boolean;
  turno_abierto_id: number | null;
  mesas?: Mesa[];
};

export type Mesa = {
  id: number;
  punto_venta_id: number;
  nombre: string;
  zona: string;
  capacidad: number;
  estado: "LIBRE" | "OCUPADA" | "CUENTA";
  qr_token: string;
  activo: boolean;
};

export type Turno = {
  id: number;
  punto_venta_id: number;
  estado: "ABIERTO" | "CERRADO";
  fondo_inicial: string;
  efectivo_declarado: string | null;
  fecha_apertura: string;
  fecha_cierre: string | null;
  abierto_por: string | null;
  cerrado_por: string | null;
  notas: string;
  corte: Corte | Record<string, never>;
};

export type Corte = {
  tickets_cobrados: number;
  tickets_abiertos: number;
  tickets_cancelados: number;
  subtotal: string;
  descuentos: string;
  propinas: string;
  venta_total: string;
  por_forma_pago: Record<string, { monto: string; operaciones: number }>;
  fondo_inicial: string;
  efectivo_esperado: string;
  efectivo_declarado: string | null;
  diferencia: string | null;
};

export type TicketItem = {
  id: number;
  producto_id: number;
  descripcion: string;
  cantidad: string;
  precio_unitario: string;
  descuento: string;
  importe: string;
  estado: "PENDIENTE" | "EN_PREPARACION" | "SERVIDO" | "CANCELADO";
  notas: string;
};

export type CobroQR = {
  id: number;
  referencia: string;
  monto: string;
  estado: "PENDIENTE" | "PAGADO" | "EXPIRADO" | "CANCELADO";
  metodo: string;
  qr_payload: string;
  expira_en: string | null;
  fecha_pago: string | null;
};

export type Pago = {
  id: number;
  forma: string;
  monto: string;
  recibido: string | null;
  cambio: string;
  referencia: string;
  cobro_qr_id: number | null;
  fecha: string;
};

export type Ticket = {
  id: number;
  folio: string;
  estado: "ABIERTO" | "COBRADO" | "CANCELADO";
  origen: "CAJA" | "MENU_QR";
  tipo_servicio: "COMER_AQUI" | "PARA_LLEVAR" | "DOMICILIO";
  comensales: number;
  punto_venta_id: number;
  punto_venta_codigo: string | null;
  turno_id: number | null;
  mesa_id: number | null;
  mesa_nombre: string | null;
  cliente_id: number | null;
  orden_id: number | null;
  subtotal: string;
  descuento: string;
  propina: string;
  total: string;
  pagado: string;
  saldo: string;
  notas: string;
  fecha_creacion: string;
  fecha_cobro: string | null;
  items?: TicketItem[];
  pagos?: Pago[];
  cobros_qr?: CobroQR[];
};

export type PosContexto = {
  capa_negocio: { id: number; nombre: string };
  plan: {
    clave: string;
    nombre: string;
    modulos: string[];
    funciones: string[];
  } | null;
  capacidades: {
    menu_qr: boolean;
    pedido_desde_mesa: boolean;
    propinas: boolean;
    cuenta_dividida: boolean;
    descuentos: boolean;
  };
  puntos_venta: PuntoVenta[];
};

export type ReporteVenta = {
  tickets: number;
  venta_total: string;
  propinas: string;
  descuentos: string;
  ticket_promedio: string;
  por_forma_pago: { forma: string; monto: string; operaciones: number }[];
  por_producto: {
    producto_id: number;
    producto: string;
    cantidad: string;
    importe: string;
  }[];
};

export class PosApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PosApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    cache: "no-store",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!response.ok) {
    let detalle = `No se pudo completar la operacion (${response.status}).`;
    try {
      const body = await response.json();
      if (body?.detail) detalle = String(body.detail);
    } catch {
      // respuesta sin cuerpo JSON: se conserva el mensaje generico
    }
    throw new PosApiError(detalle, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
const patch = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export const posApi = {
  contexto: () => request<PosContexto>("/pos/contexto/"),

  puntosVenta: () => request<{ items: PuntoVenta[] }>("/pos/puntos-venta/"),
  crearPuntoVenta: (body: Record<string, unknown>) =>
    post<PuntoVenta>("/pos/puntos-venta/", body),
  actualizarPuntoVenta: (id: number, body: Record<string, unknown>) =>
    patch<PuntoVenta>(`/pos/puntos-venta/${id}/`, body),

  crearMesa: (puntoVentaId: number, body: Record<string, unknown>) =>
    post<Mesa>(`/pos/puntos-venta/${puntoVentaId}/mesas/`, body),
  actualizarMesa: (id: number, body: Record<string, unknown>) =>
    patch<Mesa>(`/pos/mesas/${id}/`, body),

  abrirTurno: (body: { punto_venta_id: number; fondo_inicial: string; notas?: string }) =>
    post<Turno>("/pos/turnos/abrir/", body),
  corte: (turnoId: number) => request<Turno>(`/pos/turnos/${turnoId}/corte/`),
  cerrarTurno: (turnoId: number, body: { efectivo_declarado?: string; notas?: string }) =>
    post<Turno>(`/pos/turnos/${turnoId}/cerrar/`, body),

  tickets: (params: Record<string, string | number | undefined>) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<{ total: number; items: Ticket[] }>(`/pos/tickets/?${query.toString()}`);
  },
  crearTicket: (body: Record<string, unknown>) => post<Ticket>("/pos/tickets/", body),
  ticket: (id: number) => request<Ticket>(`/pos/tickets/${id}/`),
  agregarItem: (ticketId: number, body: Record<string, unknown>) =>
    post<Ticket>(`/pos/tickets/${ticketId}/items/`, body),
  actualizarItem: (ticketId: number, itemId: number, body: Record<string, unknown>) =>
    patch<Ticket>(`/pos/tickets/${ticketId}/items/${itemId}/`, body),
  quitarItem: (ticketId: number, itemId: number) =>
    request<Ticket>(`/pos/tickets/${ticketId}/items/${itemId}/`, { method: "DELETE" }),
  ajustarTicket: (ticketId: number, body: Record<string, unknown>) =>
    patch<Ticket>(`/pos/tickets/${ticketId}/`, body),
  cancelarTicket: (ticketId: number) => post<Ticket>(`/pos/tickets/${ticketId}/cancelar/`),

  comandas: (puntoVentaId?: number) =>
    request<{
      items: (TicketItem & {
        ticket_id: number;
        folio: string;
        mesa: string | null;
        solicitado_en: string;
      })[];
    }>(`/pos/comandas/${puntoVentaId ? `?punto_venta_id=${puntoVentaId}` : ""}`),

  generarCobroQR: (ticketId: number, body: Record<string, unknown>) =>
    post<CobroQR>(`/pos/tickets/${ticketId}/cobro-qr/`, body),
  confirmarCobroQR: (referencia: string, body: { referencia_externa?: string }) =>
    post<CobroQR>(`/pos/cobros-qr/${referencia}/confirmar/`, body),

  registrarPago: (ticketId: number, body: Record<string, unknown>) =>
    post<Ticket>(`/pos/tickets/${ticketId}/pagos/`, body),

  reporteVenta: (params: Record<string, string | number | undefined>) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") query.set(key, String(value));
    });
    return request<ReporteVenta>(`/pos/reportes/venta/?${query.toString()}`);
  },
};

/** Endpoints publicos: no requieren sesion (menu y cobro por QR). */
export const posPublicApi = {
  menu: (token: string) =>
    request<{
      negocio: string;
      moneda: string;
      mesa: Mesa | null;
      permite_pedido: boolean;
      propina_sugerida: string;
      categorias: {
        nombre: string;
        productos: {
          id: number;
          nombre: string;
          descripcion: string;
          precio: string;
          imagen_url: string | null;
        }[];
      }[];
    }>(`/pos/publico/menu/${token}/`),

  pedido: (
    token: string,
    body: { items: { producto_id: number; cantidad: string; notas?: string }[]; comensales?: number }
  ) =>
    post<{ folio: string; mesa: string; total: string; mensaje: string; items: TicketItem[] }>(
      `/pos/publico/menu/${token}/pedido/`,
      body
    ),

  cobro: (referencia: string) =>
    request<{
      referencia: string;
      estado: string;
      monto: string;
      moneda: string;
      metodo: string;
      negocio: string;
      folio: string;
      expira_en: string | null;
    }>(`/pos/publico/cobro/${referencia}/`),
};
