import Link from "next/link";

interface LegalSection {
  title: string;
  body: string[];
}

interface LegalPageProps {
  title: string;
  updatedAt: string;
  intro: string;
  sections: LegalSection[];
}

export default function LegalPage({
  title,
  updatedAt,
  intro,
  sections,
}: LegalPageProps) {
  return (
    <main className="min-h-screen bg-[#050816] px-5 py-8 text-zinc-100 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-4xl">
        <header className="border-b border-white/10 pb-6">
          <Link
            href="https://betterp.net"
            className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/20"
          >
            BettERP
          </Link>
          <p className="mt-8 text-xs uppercase tracking-[0.24em] text-cyan-200/70">
            Informacion legal
          </p>
          <h1 className="mt-3 text-3xl font-bold text-white sm:text-4xl">
            {title}
          </h1>
          <p className="mt-4 text-sm leading-7 text-zinc-300">{intro}</p>
          <p className="mt-3 text-xs text-zinc-500">
            Ultima actualizacion: {updatedAt}
          </p>
          <p className="mt-3 text-xs leading-6 text-zinc-500">
            Esta pagina resume politicas comerciales y operativas de BetterP. Si
            existe una propuesta, contrato o anexo firmado, ese documento puede
            complementar estas condiciones.
          </p>
        </header>

        <div className="mt-8 space-y-6">
          {sections.map((section) => (
            <section
              key={section.title}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
            >
              <h2 className="text-lg font-semibold text-white">{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-zinc-300">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="mt-10 border-t border-white/10 pt-6 text-sm text-zinc-400">
          <p>
            Para solicitudes relacionadas con estas politicas escribe a{" "}
            <a
              href="mailto:contacto@betterp.net"
              className="font-semibold text-cyan-200"
            >
              contacto@betterp.net
            </a>
            .
          </p>
        </footer>
      </div>
    </main>
  );
}
