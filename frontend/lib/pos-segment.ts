/**
 * Rutas del segmento POS QR.
 *
 * El producto tiene una sola solucion (`pos_qr`) y una URL de entrada propia:
 * `/pos-qr` es la pagina del segmento y `/pos-qr/entrar` resuelve el acceso
 * de un usuario ya autenticado hacia su caja.
 */

export const SOLUTION_KEY = "pos_qr";

export const SEGMENT_PATH = "/pos-qr";
export const SEGMENT_ENTRY_PATH = "/pos-qr/entrar";
export const CAJA_PATH = "/pos-qr/caja";

export const POS_NAV = {
  caja: CAJA_PATH,
  mesas: "/pos-qr/mesas",
  comandas: "/pos-qr/comandas",
  productos: "/pos-qr/productos",
  catalogos: "/pos-qr/catalogos",
  inventario: "/pos-qr/inventario",
  cajas: "/pos-qr/cajas",
  corte: "/pos-qr/corte",
  reportes: "/pos-qr/reportes",
} as const;

/** Rutas internas a las que el login puede redirigir tras autenticar. */
const DEEP_LINKS = new Set<string>([
  "/dashboard",
  "/clientes",
  "/configuracion",
  "/cuenta",
  SEGMENT_ENTRY_PATH,
  ...Object.values(POS_NAV),
]);

export function safeInternalRedirect(value?: string | null): string {
  const next = (value || "").trim();
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "";
  }
  return next;
}

export function segmentLoginPath(next?: string): string {
  const params = new URLSearchParams({ redirectTo: next || SEGMENT_ENTRY_PATH });
  return `/login?${params.toString()}`;
}

export function segmentRegistrationPath(planKey: string, periodicidad = "MENSUAL"): string {
  const params = new URLSearchParams({ plan: planKey, periodicidad, solution: SOLUTION_KEY });
  return `/registro?${params.toString()}`;
}

/** Destino tras el login: `redirectTo` explicito, o la entrada del segmento. */
export function resolveSolutionRedirectFromSearch(search: string): string {
  const params = new URLSearchParams(search);
  const redirectTo = safeInternalRedirect(params.get("redirectTo"));
  if (redirectTo) return redirectTo;
  const solution = (params.get("solution") || "").trim().toLowerCase().replaceAll("-", "_");
  return solution === SOLUTION_KEY ? SEGMENT_ENTRY_PATH : "";
}

/** Deep link solicitado con `?next=`, solo si apunta a una ruta conocida. */
export function requestedDeepLink(search: string): string {
  const next = new URLSearchParams(search).get("next")?.trim() || "";
  return DEEP_LINKS.has(next) ? next : "";
}

export function normalizeLaunchUrl(value?: string | null): string {
  return safeInternalRedirect(value) || CAJA_PATH;
}
