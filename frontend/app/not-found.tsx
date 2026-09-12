"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const LEGACY_APP_HOSTS = new Set(["app.betterp.net"]);
const CANONICAL_ORIGIN = "https://betterp.net";

export default function NotFound() {
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const host = window.location.hostname.toLowerCase();

    if (!LEGACY_APP_HOSTS.has(host)) {
      return;
    }

    setRedirecting(true);
    window.location.replace(
      CANONICAL_ORIGIN +
        window.location.pathname +
        window.location.search +
        window.location.hash
    );
  }, []);

  if (redirecting) {
    return null;
  }

  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
        404
      </p>
      <h1 className="mt-3 text-3xl font-semibold text-slate-950">
        Esta pagina no existe.
      </h1>
      <Link
        href="/"
        className="mt-6 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
      >
        Volver al inicio
      </Link>
    </main>
  );
}
