import Link from "next/link";

export default function PagoCanceladoPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),transparent_28%),linear-gradient(180deg,#04070f_0%,#060a14_100%)] px-5 py-12 text-white">
      <section className="mx-auto max-w-2xl rounded-[32px] border border-amber-400/20 bg-amber-400/10 p-8 text-center shadow-2xl">
        <p className="text-[11px] uppercase tracking-[0.28em] text-amber-200">
          Pago cancelado
        </p>
        <h1 className="mt-4 text-3xl font-semibold">No se completo el checkout.</h1>
        <p className="mt-4 text-sm leading-7 text-amber-50/85">
          Tu cuenta puede quedar creada en modo prueba o pendiente de pago. Puedes
          intentar de nuevo, cambiar de plan o solicitar una demo si quieres que
          revisemos el alcance antes de contratar.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/registro"
            className="rounded-full bg-amber-300 px-5 py-3 text-sm font-semibold text-zinc-950 hover:bg-amber-200"
          >
            Reintentar pago
          </Link>
          <Link
            href="https://betterp.net#contacto"
            className="rounded-full border border-white/10 px-5 py-3 text-sm font-semibold text-amber-50 hover:border-amber-300/40 hover:bg-amber-300/10"
          >
            Solicitar demo
          </Link>
        </div>
      </section>
    </main>
  );
}
