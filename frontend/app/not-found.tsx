import Link from "next/link";

import { SEGMENT_PATH } from "@/lib/pos-segment";

export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">404</p>
      <h1 className="mt-3 text-3xl font-semibold text-zinc-100">Esta pagina no existe.</h1>
      <Link
        href={SEGMENT_PATH}
        className="mt-6 rounded-2xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400"
      >
        Volver al inicio
      </Link>
    </main>
  );
}
