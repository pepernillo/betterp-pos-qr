"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  STORAGE_KEYS,
  buildApiUrl,
  isBackendApiUrl,
  readStoredAccessToken,
  readStoredRefreshToken,
  readStoredSelectedCapaId,
  resolveFetchUrl,
} from "@/lib/api";
import { resolveSolutionRedirectFromSearch } from "@/lib/solution-launch";

type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthUser {
  id: number;
  email: string;
  nombre: string;
  avatar_url?: string | null;
  email_verificado?: boolean;
  is_platform_admin?: boolean;
  initials: string;
}

export interface AuthMembership {
  id: number;
  rol: "OWNER_ADMIN" | "OPERADOR" | "CONSULTA";
  activo: boolean;
  capa_negocio: {
    id: number;
    nombre: string;
    tipo_capa: string;
    activo: boolean;
    entidades_count?: number | null;
  };
}

export interface TwoFactorChallenge {
  requires_two_factor: true;
  challenge_token: string;
  masked_email: string;
  expira_en: string;
  detail: string;
}

interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

interface AuthPayload {
  user: AuthUser;
  memberships: AuthMembership[];
  current_membership: AuthMembership | null;
  tokens?: AuthTokens;
}

interface AuthFlowResult {
  requiresTwoFactor: boolean;
  challenge?: TwoFactorChallenge;
  user?: AuthUser;
}

interface AuthRedirectOptions {
  redirectTo?: string;
  skipRedirect?: boolean;
}

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  memberships: AuthMembership[];
  currentMembership: AuthMembership | null;
  selectedCapaId: number | null;
  canWrite: boolean;
  isOwnerAdmin: boolean;
  login: (
    payload: { email: string; password: string },
    options?: AuthRedirectOptions
  ) => Promise<AuthFlowResult>;
  loginBackoffice: (
    payload: { email: string; password: string },
    options?: AuthRedirectOptions
  ) => Promise<AuthFlowResult>;
  bootstrap: (payload: {
    email: string;
    password: string;
    nombre: string;
    nombre_capa: string;
    tipo_capa: string;
  }) => Promise<void>;
  registerTrial: (payload: {
    nombre: string;
    email: string;
    password: string;
    password_confirm: string;
    nombre_capa: string;
    tipo_capa: string;
    telefono?: string;
  }, options?: AuthRedirectOptions) => Promise<AuthFlowResult>;
  registerCheckout: (payload: {
    nombre: string;
    email: string;
    password: string;
    password_confirm: string;
    nombre_capa: string;
    tipo_capa: string;
    telefono?: string;
    plan_id?: number | null;
    periodicidad?: string;
  }, options?: AuthRedirectOptions) => Promise<AuthFlowResult>;
  registerTrialWithGoogle: (
    payload: {
      id_token: string;
      nombre_capa: string;
      tipo_capa: string;
      telefono?: string;
    },
    options?: AuthRedirectOptions
  ) => Promise<AuthFlowResult>;
  registerCheckoutWithGoogle: (
    payload: {
      id_token: string;
      nombre_capa: string;
      tipo_capa: string;
      telefono?: string;
      plan_id?: number | null;
      periodicidad?: string;
    },
    options?: AuthRedirectOptions
  ) => Promise<AuthFlowResult>;
  loginWithGoogle: (
    idToken: string,
    options?: AuthRedirectOptions
  ) => Promise<AuthFlowResult>;
  acceptInvitation: (token: string, payload: { nombre: string; password: string; password_confirm: string }) => Promise<AuthFlowResult>;
  acceptPlatformAdminInvitation: (
    token: string,
    payload: { nombre: string; password: string; password_confirm: string }
  ) => Promise<AuthFlowResult>;
  verifyTwoFactor: (
    payload: { challengeToken: string; codigo: string },
    options?: AuthRedirectOptions
  ) => Promise<AuthUser>;
  resendTwoFactor: (challengeToken: string) => Promise<TwoFactorChallenge>;
  requestPasswordRecovery: (email: string) => Promise<string>;
  confirmPasswordRecovery: (token: string, payload: { password: string; password_confirm: string }) => Promise<string>;
  changePassword: (payload: {
    current_password: string;
    password: string;
    password_confirm: string;
  }) => Promise<string>;
  logout: (options?: AuthRedirectOptions) => Promise<void>;
  selectCapa: (capaId: number) => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/registro" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/data-deletion" ||
    pathname.startsWith("/soluciones/") ||
    pathname === "/backoffice/login" ||
    pathname === "/admin/login" ||
    pathname === "/recuperar-acceso" ||
    pathname.startsWith("/backoffice/invitacion/") ||
    pathname.startsWith("/admin/invitacion/") ||
    pathname.startsWith("/invitacion/") ||
    pathname.startsWith("/portal-cliente/") ||
    pathname.startsWith("/pago/") ||
    pathname.startsWith("/vendedores/") ||
    pathname.startsWith("/restablecer-acceso/")
  );
}

function isBackofficeAreaPath(pathname: string): boolean {
  return (
    pathname === "/backoffice" ||
    pathname.startsWith("/backoffice/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/administracion-negocio" ||
    pathname.startsWith("/administracion-negocio/")
  );
}

function isBackofficeLoginPath(pathname: string): boolean {
  return pathname === "/backoffice/login" || pathname === "/admin/login";
}

function resolveAnonymousLoginRoute(pathname: string): string {
  return isBackofficeAreaPath(pathname) ? "/backoffice/login" : "/login";
}

function isAuthEndpoint(url: string): boolean {
  return (
    url.includes("/accounts/auth/login/") ||
    url.includes("/accounts/auth/platform/login/") ||
    url.includes("/accounts/auth/bootstrap-status/") ||
    url.includes("/accounts/auth/bootstrap/") ||
    url.includes("/accounts/auth/trial-register/") ||
    url.includes("/accounts/auth/checkout-register/") ||
    url.includes("/accounts/auth/google/") ||
    url.includes("/accounts/auth/refresh/") ||
    url.includes("/accounts/auth/invitaciones/") ||
    url.includes("/accounts/auth/platform-admins/invitaciones/") ||
    url.includes("/accounts/auth/password-recovery/") ||
    url.includes("/accounts/auth/two-factor/")
  );
}

function persistTokens(tokens?: AuthTokens) {
  if (typeof window === "undefined") {
    return;
  }
  if (!tokens) {
    return;
  }
  window.localStorage.setItem(STORAGE_KEYS.accessToken, tokens.access_token);
  window.localStorage.setItem(STORAGE_KEYS.refreshToken, tokens.refresh_token);
}

function clearPersistedSession() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEYS.accessToken);
  window.localStorage.removeItem(STORAGE_KEYS.refreshToken);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [memberships, setMemberships] = useState<AuthMembership[]>([]);
  const [selectedCapaId, setSelectedCapaId] = useState<number | null>(null);
  const accessTokenRef = useRef("");
  const refreshTokenRef = useRef("");
  const selectedCapaIdRef = useRef<number | null>(null);
  const originalFetchRef = useRef<typeof window.fetch | null>(null);
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null);

  const currentMembership =
    memberships.find((membership) => membership.capa_negocio.id === selectedCapaId) ??
    memberships[0] ??
    null;

  const canWrite =
    currentMembership?.rol === "OWNER_ADMIN" ||
    currentMembership?.rol === "OPERADOR";
  const isOwnerAdmin = currentMembership?.rol === "OWNER_ADMIN";

  const applyAuthPayload = useCallback((payload: AuthPayload) => {
    setUser(payload.user);
    setMemberships(payload.memberships ?? []);
    persistTokens(payload.tokens);
    accessTokenRef.current = payload.tokens?.access_token ?? accessTokenRef.current;
    refreshTokenRef.current = payload.tokens?.refresh_token ?? refreshTokenRef.current;

    const availableMemberships = payload.memberships ?? [];
    const storedCapaId = readStoredSelectedCapaId();
    const nextCapa =
      availableMemberships.find(
        (membership) => membership.capa_negocio.id === storedCapaId
      ) ??
      payload.current_membership ??
      availableMemberships[0] ??
      null;
    const nextCapaId = nextCapa?.capa_negocio.id ?? null;
    setSelectedCapaId(nextCapaId);
    selectedCapaIdRef.current = nextCapaId;
    if (typeof window !== "undefined") {
      if (nextCapaId === null) {
        window.localStorage.removeItem(STORAGE_KEYS.selectedCapaId);
      } else {
        window.localStorage.setItem(STORAGE_KEYS.selectedCapaId, String(nextCapaId));
      }
    }
    setStatus("authenticated");
  }, []);

  const completeAuth = useCallback(
    (payload: AuthPayload, redirectTo?: string) => {
      applyAuthPayload(payload);
      router.replace(redirectTo || "/dashboard");
    },
    [applyAuthPayload, router]
  );

  const clearSession = useCallback(() => {
    clearPersistedSession();
    accessTokenRef.current = "";
    refreshTokenRef.current = "";
    setUser(null);
    setMemberships([]);
    setSelectedCapaId(null);
    selectedCapaIdRef.current = null;
    setStatus("anonymous");
  }, []);

  const rawFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const fetchImpl = originalFetchRef.current ?? window.fetch;
      return fetchImpl(input, init);
    },
    []
  );

  const refreshTokens = useCallback(async (): Promise<boolean> => {
    if (!refreshTokenRef.current) {
      clearSession();
      return false;
    }
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    refreshInFlightRef.current = (async () => {
      try {
        const response = await rawFetch(buildApiUrl("/accounts/auth/refresh/"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ refresh_token: refreshTokenRef.current }),
        });
        if (!response.ok) {
          clearSession();
          return false;
        }
        const payload = (await response.json()) as AuthPayload;
        applyAuthPayload(payload);
        return true;
      } catch {
        clearSession();
        return false;
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    return refreshInFlightRef.current;
  }, [applyAuthPayload, clearSession, rawFetch]);

  const refreshProfile = useCallback(async () => {
    if (!accessTokenRef.current) {
      clearSession();
      return;
    }
    const response = await rawFetch(buildApiUrl("/accounts/auth/me/"), {
      headers: {
        Authorization: `Bearer ${accessTokenRef.current}`,
        ...(selectedCapaIdRef.current
          ? { "X-BettERP-Capa-ID": String(selectedCapaIdRef.current) }
          : {}),
      },
      cache: "no-store",
    });
    if (response.status === 401) {
      const refreshed = await refreshTokens();
      if (!refreshed) {
        return;
      }
      return refreshProfile();
    }
    if (!response.ok) {
      throw new Error("No se pudo cargar la sesion actual.");
    }
    const payload = (await response.json()) as AuthPayload;
    applyAuthPayload(payload);
  }, [applyAuthPayload, clearSession, rawFetch, refreshTokens]);

  const login = useCallback(
    async (
      payload: { email: string; password: string },
      options?: AuthRedirectOptions
    ) => {
      const response = await rawFetch(buildApiUrl("/accounts/auth/login/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as (AuthPayload &
        Partial<TwoFactorChallenge>) & {
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo iniciar sesion.");
      }
      if (response.status === 202 && body.requires_two_factor && body.challenge_token) {
        return {
          requiresTwoFactor: true,
          challenge: body as TwoFactorChallenge,
        };
      }
      completeAuth(body, options?.redirectTo);
      return { requiresTwoFactor: false, user: body.user };
    },
    [completeAuth, rawFetch]
  );

  const loginBackoffice = useCallback(
    async (
      payload: { email: string; password: string },
      options?: AuthRedirectOptions
    ) => {
      const response = await rawFetch(buildApiUrl("/accounts/auth/platform/login/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as (AuthPayload &
        Partial<TwoFactorChallenge>) & {
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo iniciar sesion en el backoffice.");
      }
      if (response.status === 202 && body.requires_two_factor && body.challenge_token) {
        return {
          requiresTwoFactor: true,
          challenge: body as TwoFactorChallenge,
        };
      }
      completeAuth(body, options?.redirectTo || "/backoffice");
      return { requiresTwoFactor: false, user: body.user };
    },
    [completeAuth, rawFetch]
  );

  const bootstrap = useCallback(
    async (payload: {
      email: string;
      password: string;
      nombre: string;
      nombre_capa: string;
      tipo_capa: string;
    }) => {
      const response = await rawFetch(buildApiUrl("/accounts/auth/bootstrap/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as AuthPayload & {
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo inicializar el sistema.");
      }
      applyAuthPayload(body);
      router.replace("/dashboard");
    },
    [applyAuthPayload, rawFetch, router]
  );

  const loginWithGoogle = useCallback(
    async (idToken: string, options?: AuthRedirectOptions) => {
      const response = await rawFetch(buildApiUrl("/accounts/auth/google/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: idToken }),
      });
      const body = (await response.json().catch(() => ({}))) as (AuthPayload &
        Partial<TwoFactorChallenge>) & {
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo iniciar sesion con Google.");
      }
      if (response.status === 202 && body.requires_two_factor && body.challenge_token) {
        return {
          requiresTwoFactor: true,
          challenge: body as TwoFactorChallenge,
        };
      }
      completeAuth(body, options?.redirectTo);
      return { requiresTwoFactor: false, user: body.user };
    },
    [completeAuth, rawFetch]
  );

  const registerTrial = useCallback(
    async (payload: {
      nombre: string;
      email: string;
      password: string;
      password_confirm: string;
      nombre_capa: string;
      tipo_capa: string;
      telefono?: string;
    }, options?: AuthRedirectOptions) => {
      const response = await rawFetch(buildApiUrl("/accounts/auth/trial-register/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as AuthPayload & {
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo crear la prueba.");
      }
      completeAuth(body, options?.redirectTo || "/dashboard");
      return { requiresTwoFactor: false, user: body.user };
    },
    [completeAuth, rawFetch]
  );

  const registerCheckout = useCallback(
    async (payload: {
      nombre: string;
      email: string;
      password: string;
      password_confirm: string;
      nombre_capa: string;
      tipo_capa: string;
      telefono?: string;
      plan_id?: number | null;
      periodicidad?: string;
    }, options?: AuthRedirectOptions) => {
      const response = await rawFetch(buildApiUrl("/accounts/auth/checkout-register/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as AuthPayload & {
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo crear la cuenta para contratar.");
      }
      if (options?.skipRedirect) {
        applyAuthPayload(body);
      } else {
        completeAuth(body, options?.redirectTo || "/registro");
      }
      return { requiresTwoFactor: false, user: body.user };
    },
    [applyAuthPayload, completeAuth, rawFetch]
  );

  const registerTrialWithGoogle = useCallback(
    async (
      payload: {
        id_token: string;
        nombre_capa: string;
        tipo_capa: string;
        telefono?: string;
      },
      options?: AuthRedirectOptions
    ) => {
      const response = await rawFetch(
        buildApiUrl("/accounts/auth/trial-register/google/"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = (await response.json().catch(() => ({}))) as AuthPayload & {
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo crear la cuenta con Google.");
      }
      completeAuth(body, options?.redirectTo || "/dashboard");
      return { requiresTwoFactor: false, user: body.user };
    },
    [completeAuth, rawFetch]
  );

  const registerCheckoutWithGoogle = useCallback(
    async (
      payload: {
        id_token: string;
        nombre_capa: string;
        tipo_capa: string;
        telefono?: string;
        plan_id?: number | null;
        periodicidad?: string;
      },
      options?: AuthRedirectOptions
    ) => {
      const response = await rawFetch(
        buildApiUrl("/accounts/auth/checkout-register/google/"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = (await response.json().catch(() => ({}))) as AuthPayload & {
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo crear la cuenta con Google.");
      }
      if (options?.skipRedirect) {
        applyAuthPayload(body);
      } else {
        completeAuth(body, options?.redirectTo || "/registro");
      }
      return { requiresTwoFactor: false, user: body.user };
    },
    [applyAuthPayload, completeAuth, rawFetch]
  );

  const acceptInvitation = useCallback(
    async (
      token: string,
      payload: { nombre: string; password: string; password_confirm: string }
    ) => {
      const response = await rawFetch(
        buildApiUrl(`/accounts/auth/invitaciones/${token}/aceptar/`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = (await response.json().catch(() => ({}))) as (AuthPayload &
        Partial<TwoFactorChallenge>) & {
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo aceptar la invitacion.");
      }
      if (response.status === 202 && body.requires_two_factor && body.challenge_token) {
        return {
          requiresTwoFactor: true,
          challenge: body as TwoFactorChallenge,
        };
      }
      applyAuthPayload(body);
      router.replace("/dashboard");
      return { requiresTwoFactor: false };
    },
    [applyAuthPayload, rawFetch, router]
  );

  const acceptPlatformAdminInvitation = useCallback(
    async (
      token: string,
      payload: { nombre: string; password: string; password_confirm: string }
    ) => {
      const response = await rawFetch(
        buildApiUrl(`/accounts/auth/platform-admins/invitaciones/${token}/aceptar/`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = (await response.json().catch(() => ({}))) as (AuthPayload &
        Partial<TwoFactorChallenge>) & {
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(
          body.detail || "No se pudo aceptar la invitacion del backoffice."
        );
      }
      if (response.status === 202 && body.requires_two_factor && body.challenge_token) {
        return {
          requiresTwoFactor: true,
          challenge: body as TwoFactorChallenge,
        };
      }
      applyAuthPayload(body);
      router.replace("/backoffice");
      return { requiresTwoFactor: false };
    },
    [applyAuthPayload, rawFetch, router]
  );

  const verifyTwoFactor = useCallback(
    async (
      payload: { challengeToken: string; codigo: string },
      options?: AuthRedirectOptions
    ) => {
      const response = await rawFetch(buildApiUrl("/accounts/auth/two-factor/verify/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge_token: payload.challengeToken,
          codigo: payload.codigo,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as AuthPayload & {
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo verificar el segundo paso.");
      }
      completeAuth(body, options?.redirectTo);
      return body.user;
    },
    [completeAuth, rawFetch]
  );

  const resendTwoFactor = useCallback(
    async (challengeToken: string) => {
      const response = await rawFetch(buildApiUrl("/accounts/auth/two-factor/resend/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge_token: challengeToken }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<TwoFactorChallenge> & {
        detail?: string;
      };
      if (!response.ok || !body.challenge_token) {
        throw new Error(body.detail || "No se pudo reenviar el codigo.");
      }
      return body as TwoFactorChallenge;
    },
    [rawFetch]
  );

  const requestPasswordRecovery = useCallback(
    async (email: string) => {
      const response = await rawFetch(buildApiUrl("/accounts/auth/password-recovery/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await response.json().catch(() => ({}))) as { detail?: string; mensaje?: string };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo solicitar la recuperacion.");
      }
      return (
        body.mensaje ||
        "Si el correo existe en BetterP, enviaremos un enlace para restablecer la contrasena."
      );
    },
    [rawFetch]
  );

  const confirmPasswordRecovery = useCallback(
    async (
      token: string,
      payload: { password: string; password_confirm: string }
    ) => {
      const response = await rawFetch(
        buildApiUrl(`/accounts/auth/password-recovery/${token}/confirm/`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo restablecer la contrasena.");
      }
      clearSession();
      return body.mensaje || "Contrasena actualizada correctamente.";
    },
    [clearSession, rawFetch]
  );

  const changePassword = useCallback(
    async (payload: {
      current_password: string;
      password: string;
      password_confirm: string;
    }) => {
      if (!accessTokenRef.current) {
        throw new Error("Tu sesion ya no esta disponible. Vuelve a iniciar sesion.");
      }

      const response = await rawFetch(buildApiUrl("/accounts/auth/password-change/"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessTokenRef.current}`,
          ...(selectedCapaIdRef.current
            ? { "X-BettERP-Capa-ID": String(selectedCapaIdRef.current) }
            : {}),
        },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo actualizar la contrasena.");
      }
      return (
        body.mensaje ||
        "Contrasena actualizada correctamente. Mantuvimos esta sesion abierta."
      );
    },
    [rawFetch]
  );

  const logout = useCallback(async (options?: AuthRedirectOptions) => {
    try {
      if (accessTokenRef.current) {
        await rawFetch(buildApiUrl("/accounts/auth/logout/"), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessTokenRef.current}`,
            ...(selectedCapaIdRef.current
              ? { "X-BettERP-Capa-ID": String(selectedCapaIdRef.current) }
              : {}),
          },
        });
      }
    } finally {
      clearSession();
      router.replace(options?.redirectTo || "/login");
    }
  }, [clearSession, rawFetch, router]);

  const selectCapa = useCallback((capaId: number) => {
    setSelectedCapaId(capaId);
    selectedCapaIdRef.current = capaId;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEYS.selectedCapaId, String(capaId));
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    accessTokenRef.current = readStoredAccessToken();
    refreshTokenRef.current = readStoredRefreshToken();
    selectedCapaIdRef.current = readStoredSelectedCapaId();
    setSelectedCapaId(selectedCapaIdRef.current);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || originalFetchRef.current) {
      return;
    }
    originalFetchRef.current = window.fetch.bind(window);
    const originalFetch = originalFetchRef.current;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!isBackendApiUrl(input)) {
        return originalFetch(input, init);
      }

      const url = resolveFetchUrl(input);
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      );

      if (accessTokenRef.current && !isAuthEndpoint(url) && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${accessTokenRef.current}`);
      }
      if (
        selectedCapaIdRef.current &&
        !headers.has("X-BettERP-Capa-ID") &&
        !isAuthEndpoint(url)
      ) {
        headers.set("X-BettERP-Capa-ID", String(selectedCapaIdRef.current));
      }

      const response = await originalFetch(input, {
        ...init,
        headers,
      });

      if (response.status !== 401 || isAuthEndpoint(url)) {
        return response;
      }

      const refreshed = await refreshTokens();
      if (!refreshed || !accessTokenRef.current) {
        return response;
      }

      headers.set("Authorization", `Bearer ${accessTokenRef.current}`);
      return originalFetch(input, {
        ...init,
        headers,
      });
    };

    return () => {
      if (originalFetchRef.current) {
        window.fetch = originalFetchRef.current;
      }
    };
  }, [refreshTokens]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const accessToken = readStoredAccessToken();
    const refreshToken = readStoredRefreshToken();
    accessTokenRef.current = accessToken;
    refreshTokenRef.current = refreshToken;

    if (!accessToken) {
      setStatus("anonymous");
      return;
    }

    let cancelled = false;
    const bootstrapSession = async () => {
      try {
        const response = await rawFetch(buildApiUrl("/accounts/auth/me/"), {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(selectedCapaIdRef.current
              ? { "X-BettERP-Capa-ID": String(selectedCapaIdRef.current) }
              : {}),
          },
          cache: "no-store",
        });

        if (response.status === 401) {
          const refreshed = await refreshTokens();
          if (!refreshed || cancelled) {
            return;
          }
          return;
        }

        if (!response.ok) {
          throw new Error("No se pudo validar la sesion.");
        }

        const payload = (await response.json()) as AuthPayload;
        if (!cancelled) {
          applyAuthPayload(payload);
        }
      } catch {
        if (!cancelled) {
          clearSession();
        }
      }
    };

    void bootstrapSession();

    return () => {
      cancelled = true;
    };
  }, [applyAuthPayload, clearSession, rawFetch, refreshTokens]);

  useEffect(() => {
    if (status === "loading") {
      return;
    }
    if (status === "authenticated" && pathname === "/login") {
      const solutionRedirect =
        typeof window === "undefined"
          ? ""
          : resolveSolutionRedirectFromSearch(window.location.search);
      router.replace(solutionRedirect || "/dashboard");
      return;
    }
    if (status === "authenticated" && isBackofficeLoginPath(pathname)) {
      router.replace(user?.is_platform_admin ? "/backoffice" : "/dashboard");
      return;
    }
    if (
      status === "authenticated" &&
      isBackofficeAreaPath(pathname) &&
      !isBackofficeLoginPath(pathname) &&
      !user?.is_platform_admin
    ) {
      router.replace("/dashboard");
      return;
    }
    if (status === "anonymous" && !isPublicPath(pathname)) {
      router.replace(resolveAnonymousLoginRoute(pathname));
    }
  }, [pathname, router, status, user?.is_platform_admin]);

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        memberships,
        currentMembership,
        selectedCapaId,
        canWrite,
        isOwnerAdmin,
        login,
        loginBackoffice,
        bootstrap,
        registerTrial,
        registerCheckout,
        registerTrialWithGoogle,
        registerCheckoutWithGoogle,
        loginWithGoogle,
        acceptInvitation,
        acceptPlatformAdminInvitation,
        verifyTwoFactor,
        resendTwoFactor,
        requestPasswordRecovery,
        confirmPasswordRecovery,
        changePassword,
        logout,
        selectCapa,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth debe usarse dentro de AuthProvider.");
  }
  return context;
}
