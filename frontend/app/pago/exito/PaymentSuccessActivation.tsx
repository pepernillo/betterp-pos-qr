"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { buildApiUrl } from "@/lib/api";

type ActivationState = "validating" | "active" | "pending" | "error";

export default function PaymentSuccessActivation() {
  const searchParams = useSearchParams();
  const checkoutSessionId = searchParams.get("session_id") || "";
  const { status, refreshProfile } = useAuth();
  const [activationState, setActivationState] =
    useState<ActivationState>("validating");
  const [message, setMessage] = useState(
    "Estamos validando el pago directamente con Stripe."
  );

  const confirmCheckout = useCallback(async () => {
    if (status === "loading") {
      return;
    }
    if (status !== "authenticated") {
      setActivationState("pending");
      setMessage(
        "Stripe recibio el pago. Inicia sesion con la cuenta que contrataste para terminar de activar tu acceso."
      );
      return;
    }

    setActivationState("validating");
    setMessage("Estamos validando el pago directamente con Stripe.");
    try {
      const response = await fetch(
        buildApiUrl("/billing/suscripcion/checkout/confirmar/"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checkout_session_id: checkoutSessionId }),
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        subscription?: {
          acceso_activo?: boolean;
          estatus?: string;
        };
      };
      if (!response.ok) {
        throw new Error(
          body.detail ||
            "No se pudo confirmar el pago todavia. Intenta refrescar en unos segundos."
        );
      }
      await refreshProfile().catch(() => undefined);
      if (body.subscription?.acceso_activo || body.subscription?.estatus === "ACTIVA") {
        setActivationState("active");
        setMessage("Tu plan quedo activo. Ya puedes entrar al dashboard.");
        return;
      }
      setActivationState("pending");
      setMessage(
        "El pago fue recibido, pero Stripe todavia esta terminando de confirmar la suscripcion."
      );
    } catch (error) {
      setActivationState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo confirmar el pago todavia. Intenta refrescar en unos segundos."
      );
    }
  }, [checkoutSessionId, refreshProfile, status]);

  useEffect(() => {
    void confirmCheckout();
  }, [confirmCheckout]);

  const isActive = activationState === "active";
  const isValidating = activationState === "validating";
  const badgeText = isActive
    ? "Cuenta activa"
    : isValidating
      ? "Validando pago"
      : "Pago recibido";
  const title = isActive
    ? "Tu cuenta BetterP ya esta activa."
    : "Tu cuenta BetterP esta en proceso de activacion.";

  return (
    <section className="mx-auto max-w-2xl rounded-[32px] border border-emerald-400/20 bg-emerald-400/10 p-8 text-center shadow-2xl">
      <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-200">
        {badgeText}
      </p>
      <h1 className="mt-4 text-3xl font-semibold">{title}</h1>
      <p className="mt-4 text-sm leading-7 text-emerald-50/85">
        {message}
      </p>

      {activationState === "error" ? (
        <button
          type="button"
          onClick={confirmCheckout}
          className="mt-6 rounded-full border border-amber-300/30 bg-amber-300/10 px-5 py-3 text-sm font-semibold text-amber-50 hover:bg-amber-300/15"
        >
          Reintentar activacion
        </button>
      ) : null}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link
          href={isActive ? "/dashboard" : "/configuracion#suscripcion"}
          className={`rounded-full px-5 py-3 text-sm font-semibold text-zinc-950 ${
            isActive
              ? "bg-emerald-300 hover:bg-emerald-200"
              : "bg-cyan-300 hover:bg-cyan-200"
          }`}
        >
          {isActive ? "Ir al dashboard" : "Ver mi suscripcion"}
        </Link>
        <Link
          href="/configuracion"
          className="rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-emerald-50 hover:border-emerald-300/40 hover:bg-emerald-300/10"
        >
          Configuracion
        </Link>
      </div>
    </section>
  );
}
