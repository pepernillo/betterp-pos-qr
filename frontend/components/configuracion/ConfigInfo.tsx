"use client";

export interface ConfigInfoContent {
  eyebrow?: string;
  title: string;
  summary: string;
  details: string[];
}

export function ConfigInfoButton({
  info,
  onOpen,
  className = "",
}: {
  info: ConfigInfoContent;
  onOpen: (info: ConfigInfoContent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen(info);
      }}
      aria-label={`Informacion: ${info.title}`}
      title={info.title}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/10 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20 ${className}`}
    >
      i
    </button>
  );
}

export function ConfigInfoModal({
  info,
  onClose,
}: {
  info: ConfigInfoContent | null;
  onClose: () => void;
}) {
  if (!info) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">
              {info.eyebrow || "Configuracion"}
            </p>
            <h3 className="mt-2 text-2xl font-bold text-white">{info.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 transition-colors hover:text-white"
          >
            Cerrar
          </button>
        </div>
        <p className="mt-5 text-sm leading-relaxed text-zinc-300">
          {info.summary}
        </p>
        <div className="mt-5 space-y-3">
          {info.details.map((detail, index) => (
            <div
              key={`${info.title}-${index}`}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm leading-relaxed text-zinc-300"
            >
              {detail}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ConfigFieldLabel({
  children,
  required,
  optional,
  info,
  onInfo,
}: {
  children: string;
  required?: boolean;
  optional?: boolean;
  info?: ConfigInfoContent;
  onInfo?: (info: ConfigInfoContent) => void;
}) {
  return (
    <span className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-400">
      <span>{children}</span>
      {required ? (
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
          Obligatorio
        </span>
      ) : null}
      {!required && optional ? (
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Opcional
        </span>
      ) : null}
      {info && onInfo ? <ConfigInfoButton info={info} onOpen={onInfo} /> : null}
    </span>
  );
}
