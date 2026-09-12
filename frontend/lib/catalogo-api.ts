/** Cliente del catalogo: productos, categorias, bodegas e inventario. */

import { buildApiUrl } from "./api";
import { PosApiError } from "./pos-api";

export type Categoria = {
  id: number;
  nombre: string;
  parent_id: number | null;
  activo: boolean;
  productos_count?: number;
};

export type Producto = {
  id: number;
  internal_sku: string;
  brand_sku: string | null;
  nombre: string;
  descripcion: string | null;
  marca: string | null;
  precio_base: string;
  activo: boolean;
  categoria: { id: number; nombre: string; parent_id: number | null } | null;
  imagen_principal?: { url: string } | null;
};

export type Bodega = {
  id: number;
  codigo: string;
  nombre: string;
  tipo: string;
  activo: boolean;
  items_count?: number;
};

export type InventarioItem = {
  id: number;
  producto_id: number;
  producto_nombre?: string;
  producto_sku?: string;
  bodega_id: number;
  bodega_nombre?: string;
  stock: string;
  reservado: string;
  disponible: string;
};

export type CatalogoResponse = {
  resumen: {
    categorias_total: number;
    productos_total: number;
    productos_activos: number;
    productos_inactivos: number;
    imagenes_total: number;
  };
  capability: { modulo_requerido: string; limit: Record<string, unknown> };
  categorias: Categoria[];
  productos: Producto[];
  pagination: { page: number; page_size: number; total: number; total_pages: number };
};

export type InventarioResponse = {
  bodegas: Bodega[];
  items: InventarioItem[];
  movimientos: {
    id: number;
    tipo: string;
    cantidad: string;
    producto_nombre?: string;
    bodega_nombre?: string;
    nota: string;
    fecha_creacion: string;
  }[];
  resumen?: Record<string, unknown>;
  pagination: { page: number; page_size: number; total: number; total_pages: number };
};

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
      // sin cuerpo JSON
    }
    throw new PosApiError(detalle, response.status);
  }
  return (await response.json()) as T;
}

function query(params: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const catalogoApi = {
  catalogo: (params: Record<string, string | number | boolean | undefined> = {}) =>
    request<CatalogoResponse>(`/catalogo/catalogo/${query(params)}`),

  crearCategoria: (body: Record<string, unknown>) =>
    request<{ created: boolean; categoria: Categoria }>("/catalogo/catalogo/categorias/", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  actualizarCategoria: (id: number, body: Record<string, unknown>) =>
    request<{ categoria: Categoria }>(`/catalogo/catalogo/categorias/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  crearProducto: (body: Record<string, unknown>) =>
    request<{ created: boolean; producto: Producto }>("/catalogo/catalogo/productos/", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  actualizarProducto: (id: number, body: Record<string, unknown>) =>
    request<{ producto: Producto }>(`/catalogo/catalogo/productos/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  inventario: (params: Record<string, string | number | undefined> = {}) =>
    request<InventarioResponse>(`/catalogo/inventario/${query(params)}`),
  crearBodega: (body: Record<string, unknown>) =>
    request<{ created: boolean; bodega: Bodega }>("/catalogo/inventario/bodegas/", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ajustarInventario: (body: Record<string, unknown>) =>
    request<{ item: InventarioItem }>("/catalogo/inventario/ajustes/", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
