export type SolutionKey = "renta_facil" | "vende_facil" | "tienda_facil";

const LEGACY_BETTERP_APP_HOST = "app.betterp.net";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export const BETTERP_PUBLIC_BASE_URL = trimTrailingSlash(
  process.env.NEXT_PUBLIC_BETTERP_PUBLIC_BASE_URL || "https://betterp.net"
);

export const PLATFORM_APP_BASE_URL = trimTrailingSlash(
  process.env.NEXT_PUBLIC_PLATFORM_APP_BASE_URL || BETTERP_PUBLIC_BASE_URL
);

export const RENTA_FACIL_ENTRY_PATH = "/soluciones/renta-facil/entrar";
export const BETTERP_COMMERCE_ENTRY_PATH = "/soluciones/commerce/entrar";
export const VENDE_FACIL_ENTRY_PATH = BETTERP_COMMERCE_ENTRY_PATH;
export const TIENDA_FACIL_ENTRY_PATH = BETTERP_COMMERCE_ENTRY_PATH;

export const SOLUTION_ENTRY_PATHS: Record<SolutionKey, string> = {
  renta_facil: RENTA_FACIL_ENTRY_PATH,
  vende_facil: VENDE_FACIL_ENTRY_PATH,
  tienda_facil: TIENDA_FACIL_ENTRY_PATH,
};

export function safeInternalRedirect(value?: string | null) {
  const nextValue = (value || "").trim();
  if (!nextValue || !nextValue.startsWith("/") || nextValue.startsWith("//")) {
    return "";
  }
  return nextValue;
}

export function isLegacyBetterPAppHost(hostname: string) {
  return hostname.trim().toLowerCase() === LEGACY_BETTERP_APP_HOST;
}

export function buildBetterPUrl(path: string) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${BETTERP_PUBLIC_BASE_URL}${cleanPath}`;
}

export function solutionEntryPath(solution: SolutionKey) {
  return SOLUTION_ENTRY_PATHS[solution];
}

export function solutionLoginPath(solution: SolutionKey) {
  const params = new URLSearchParams({
    solution,
    redirectTo: solutionEntryPath(solution),
  });
  return `/login?${params.toString()}`;
}

export function solutionRegistrationPath(
  planKey: string,
  periodicidad = "MENSUAL",
  solution?: Exclude<SolutionKey, "vende_facil">
) {
  const solutionKey = solution || (planKey.startsWith("tienda_") ? "tienda_facil" : "renta_facil");
  const params = new URLSearchParams({
    plan: planKey,
    periodicidad,
    solution: solutionKey,
  });
  return `/registro?${params.toString()}`;
}

export function normalizeSolutionLaunchUrl(value?: string | null) {
  const rawValue = (value || "").trim();
  const internalRedirect = safeInternalRedirect(rawValue);
  if (internalRedirect) {
    return internalRedirect;
  }
  if (!rawValue) {
    return "/dashboard";
  }

  let platformUrl: URL | null = null;
  try {
    platformUrl = new URL(PLATFORM_APP_BASE_URL);
  } catch {
    platformUrl = null;
  }

  try {
    const parsed = new URL(rawValue);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "/dashboard";
    }
    if (isLegacyBetterPAppHost(parsed.hostname) && platformUrl) {
      parsed.protocol = platformUrl.protocol;
      parsed.hostname = platformUrl.hostname;
      parsed.port = platformUrl.port;
    }
    return parsed.toString();
  } catch {
    return "/dashboard";
  }
}

export function resolveSolutionRedirectFromSearch(search: string) {
  const params = new URLSearchParams(search);
  const redirectTo = safeInternalRedirect(params.get("redirectTo"));
  if (redirectTo) return redirectTo;
  const solution = (params.get("solution") || "").trim().toLowerCase().replaceAll("-", "_");
  if (solution === "renta_facil" || solution === "tienda_facil" || solution === "vende_facil") {
    return solutionEntryPath(solution);
  }
  return "";
}
