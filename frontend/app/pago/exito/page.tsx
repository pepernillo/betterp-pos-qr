import { Suspense } from "react";

import PaymentSuccessActivation from "./PaymentSuccessActivation";

function PaymentSuccessFallback() {
  return (
    <section className="mx-auto max-w-2xl rounded-[32px] border border-emerald-400/20 bg-emerald-400/10 p-8 text-center shadow-2xl">
      <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-200">
        Validando pago
      </p>
      <h1 className="mt-4 text-3xl font-semibold">
        Estamos preparando tu activacion.
      </h1>
      <p className="mt-4 text-sm leading-7 text-emerald-50/85">
        Confirmando el pago con Stripe antes de abrir el dashboard.
      </p>
    </section>
  );
}

export default function PagoExitoPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_28%),linear-gradient(180deg,#04070f_0%,#060a14_100%)] px-5 py-12 text-white">
      <Suspense fallback={<PaymentSuccessFallback />}>
        <PaymentSuccessActivation />
      </Suspense>
    </main>
  );
}
