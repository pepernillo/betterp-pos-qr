"use client";

export type GoogleAuthContext = "login" | "checkout";

interface BeginGoogleAuthOptions<TPending> {
  clientId: string;
  context: GoogleAuthContext;
  redirectPath: string;
  pending?: TPending;
}

export interface ConsumedGoogleAuth<TPending> {
  idToken: string;
  pending?: TPending;
  error?: string;
  errorDescription?: string;
}

const STORAGE_PREFIX = "betterp_google_oauth";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function randomToken() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  const values = new Uint32Array(4);
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(16)).join("");
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function storageKey(context: GoogleAuthContext) {
  return `${STORAGE_PREFIX}:${context}`;
}

function currentUrlWithoutHash() {
  return `${window.location.pathname}${window.location.search}`;
}

function clearGoogleHash() {
  if (typeof window === "undefined" || !window.location.hash) {
    return;
  }
  window.history.replaceState(null, "", currentUrlWithoutHash());
}

export function beginGoogleIdTokenRedirect<TPending>({
  clientId,
  context,
  redirectPath,
  pending,
}: BeginGoogleAuthOptions<TPending>) {
  if (typeof window === "undefined") {
    return;
  }

  const state = randomToken();
  const nonce = randomToken();
  const redirectUri = `${window.location.origin}${redirectPath}`;

  window.sessionStorage.setItem(
    storageKey(context),
    JSON.stringify({
      state,
      nonce,
      pending,
      created_at: new Date().toISOString(),
    })
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "id_token",
    response_mode: "fragment",
    scope: "openid email profile",
    state,
    nonce,
    prompt: "select_account",
  });

  window.location.assign(`${GOOGLE_AUTH_URL}?${params.toString()}`);
}

export function consumeGoogleIdTokenRedirect<TPending>(
  context: GoogleAuthContext
): ConsumedGoogleAuth<TPending> | null {
  if (typeof window === "undefined" || !window.location.hash) {
    return null;
  }

  const params = new URLSearchParams(window.location.hash.slice(1));
  const idToken = params.get("id_token") || "";
  const error = params.get("error") || "";
  const errorDescription = params.get("error_description") || "";
  const state = params.get("state") || "";

  if (!idToken && !error) {
    return null;
  }

  const rawPending = window.sessionStorage.getItem(storageKey(context));
  window.sessionStorage.removeItem(storageKey(context));
  clearGoogleHash();

  let parsedPending: { state?: string; pending?: TPending } = {};
  if (rawPending) {
    try {
      parsedPending = JSON.parse(rawPending) as {
        state?: string;
        pending?: TPending;
      };
    } catch {
      parsedPending = {};
    }
  }

  if (!parsedPending.state || parsedPending.state !== state) {
    return {
      idToken: "",
      error: "Estado de Google no valido.",
      errorDescription:
        "Vuelve a iniciar el registro para confirmar que la sesion sea la correcta.",
    };
  }

  return {
    idToken,
    pending: parsedPending.pending,
    error,
    errorDescription,
  };
}

