"use client";

import { type ReactNode, useEffect, useState } from "react";
import QRCode from "qrcode";

import { PosApiError, posApi, type PosContexto } from "@/lib/pos-api";

export function money(value: string | number | null | undefined, moneda = "MXN") {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: moneda,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function fechaHora(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-3xl border border-white/8 bg-zinc-900/50 p-5 text-zinc-200 ${className}`}
    >
      {title || action ? (
        <header className="mb-4 flex items-center justify-between gap-3">
          {typeof title === "string" ? (
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-400">
              {title}
            </h2>
          ) : (
            title
          )}
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Button({
  children,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
}) {
  const styles = {
    primary: "bg-cyan-500 text-zinc-950 hover:bg-cyan-400 disabled:bg-cyan-500/40",
    ghost:
      "border border-white/12 text-zinc-200 hover:border-white/30 hover:text-white disabled:text-zinc-600",
    danger:
      "border border-rose-500/30 bg-rose-500/10 text-rose-200 hover:border-rose-400/50 disabled:opacity-50",
  }[variant];
  return (
    <button
      {...props}
      className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed ${styles} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none transition-colors focus:border-cyan-500";

export function Alert({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "info" }) {
  if (!children) return null;
  const styles =
    tone === "error"
      ? "border-rose-500/25 bg-rose-500/10 text-rose-100"
      : "border-cyan-500/25 bg-cyan-500/10 text-cyan-100";
  return (
    <p className={`rounded-2xl border px-4 py-3 text-sm ${styles}`} role="status">
      {children}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-500">
      {children}
    </p>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
        {description ? <p className="mt-1.5 text-sm text-zinc-400">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

/** Codigo QR renderizado en el cliente a partir de su contenido. */
export function QrCode({ value, size = 196 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    let cancelado = false;
    if (!value) {
      setDataUrl("");
      return;
    }
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      color: { dark: "#09090b", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelado) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelado) setDataUrl("");
      });
    return () => {
      cancelado = true;
    };
  }, [size, value]);

  if (!dataUrl) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border border-dashed border-white/15 text-xs text-zinc-500"
        style={{ width: size, height: size }}
      >
        Generando codigo
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dataUrl}
      alt="Codigo QR"
      width={size}
      height={size}
      className="rounded-2xl bg-white p-2"
    />
  );
}

export function mensajeDeError(error: unknown, fallback = "Algo no salio bien.") {
  if (error instanceof PosApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

/** Carga el contexto del POS (cajas, plan y capacidades) una vez por pagina. */
export function usePosContexto() {
  const [contexto, setContexto] = useState<PosContexto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const recargar = async () => {
    try {
      setError("");
      const data = await posApi.contexto();
      setContexto(data);
    } catch (err) {
      setError(mensajeDeError(err, "No pudimos cargar la configuracion del punto de venta."));
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    void recargar();
  }, []);

  return { contexto, cargando, error, recargar };
}
