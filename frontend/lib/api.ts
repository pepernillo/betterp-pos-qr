const APP_ENV = process.env.NEXT_PUBLIC_APP_ENV ?? "production";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  (APP_ENV === "demo"
    ? "https://betterp-api-demo.onrender.com/api"
    : "https://api.betterp.net/api");

export const STORAGE_KEYS = {
  accessToken: "betterp-access-token",
  refreshToken: "betterp-refresh-token",
  selectedCapaId: "betterp-active-capa-id",
} as const;

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export function resolveFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if ("url" in input) {
    return input.url;
  }
  return String(input);
}

export function isBackendApiUrl(input: RequestInfo | URL): boolean {
  const url = resolveFetchUrl(input);
  return url.startsWith(API_BASE_URL);
}

export function readStoredAccessToken(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(STORAGE_KEYS.accessToken) ?? "";
}

export function readStoredRefreshToken(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(STORAGE_KEYS.refreshToken) ?? "";
}

export function readStoredSelectedCapaId(): number | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(STORAGE_KEYS.selectedCapaId);
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
