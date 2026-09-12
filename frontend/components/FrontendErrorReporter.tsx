"use client";

import { useEffect } from "react";

import { buildApiUrl } from "@/lib/api";

type FrontendErrorPayload = {
  source: "window_error" | "unhandled_rejection";
  error_name?: string;
  message: string;
  path: string;
  stack?: string;
};

const MAX_SENT_PER_PAGE = 5;

function sendFrontendError(payload: FrontendErrorPayload) {
  const body = JSON.stringify(payload);
  const url = buildApiUrl("/billing/frontend-errors/");
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(url, blob);
    return;
  }
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

function normalizeReason(reason: unknown): { name?: string; message: string; stack?: string } {
  if (reason instanceof Error) {
    return {
      name: reason.name,
      message: reason.message || "Unhandled client error",
      stack: reason.stack,
    };
  }
  if (typeof reason === "string") {
    return { message: reason };
  }
  try {
    return { message: "Unhandled client error", stack: JSON.stringify(reason)?.slice(0, 2000) };
  } catch {
    return { message: "Unhandled client error" };
  }
}

export default function FrontendErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const canSend = () => {
      sent += 1;
      return sent <= MAX_SENT_PER_PAGE;
    };

    const onError = (event: ErrorEvent) => {
      if (!canSend()) return;
      sendFrontendError({
        source: "window_error",
        error_name: event.error instanceof Error ? event.error.name : undefined,
        message: event.message || "Window client error",
        path: window.location.pathname || "/",
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!canSend()) return;
      const reason = normalizeReason(event.reason);
      sendFrontendError({
        source: "unhandled_rejection",
        error_name: reason.name,
        message: reason.message,
        path: window.location.pathname || "/",
        stack: reason.stack,
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
