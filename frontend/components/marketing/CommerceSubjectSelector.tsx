"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Image from "next/image";

import { buildApiUrl } from "@/lib/api";

type Storefront = { id: number; name: string; slug: string; status: string; primary_domain: string };
type Subject = {
  subject_type: string;
  subject_id: string;
  subject_version: number;
  title: string;
  sku: string;
  image?: { url?: string };
  public_url?: string;
  price?: { amount?: string; currency?: string; shipping_included?: boolean } | null;
  inventory?: { mode?: string; public_quantity?: number | null } | null;
  guards?: { eligible?: boolean; blockers?: string[] };
};
type EditorialWorkflow = {
  id: number;
  subject_id: number;
  communication_id: number;
  status: "draft" | "pending_approval" | "approved" | "scheduled" | "rejected" | "stale";
  content_hash: string;
  approval_hash: string;
  approved_by: string;
  approved_at: string | null;
  last_revalidated_at: string | null;
  scheduled_at: string | null;
  editorial: {
    title?: string;
    format?: string;
    copy?: string;
    cta_text?: string;
    cta_url?: string;
    hashtags?: string[];
    media_urls?: string[];
  };
  destinations: Array<{
    id: number;
    channel: string;
    status: string;
    remote_id: string;
    remote_url: string;
    commerce_synced_at: string | null;
    commerce_sync_error: string;
    guards?: { eligible?: boolean; blockers?: string[]; warnings?: string[] };
  }>;
};
type ImportedSubject = Subject & {
  id: number;
  snapshot_id: string;
  status: string;
  imported_at: string;
  workflow?: EditorialWorkflow | null;
};
type SelectorResponse = {
  storefronts: Storefront[];
  selected_storefront_id: number | null;
  preview: {
    pagination: { page: number; page_size: number; total: number; has_next: boolean };
    subjects: Subject[];
  };
  imports: ImportedSubject[];
  operations?: {
    status: "ok" | "warning" | "error";
    permissions: Record<string, { allowed: boolean; reason: string }>;
    flags: { bridge: boolean; import: boolean; publish: boolean; rollout: boolean };
    capability: { key: string; available: boolean };
    usage_limits: {
      items: Array<{ key: string; label: string; used: number; included: number; remaining: number | null; unlimited: boolean; status: string; message: string }>;
    };
    issues: Array<{ code: string; severity: "warning" | "error"; count: number; title: string; action: string }>;
    deployment: {
      recent_runs: Array<{
        id: number;
        phase: string;
        status: "ready" | "completed" | "blocked";
        dry_run: boolean;
        storefront_id: string;
        completed_at: string;
      }>;
    };
  };
};

const subjectTypes = [
  ["catalog_item", "Productos publicados"],
  ["product", "Productos maestros"],
  ["catalog", "Catalogos"],
  ["promotion", "Promociones"],
  ["storefront", "Tiendas"],
  ["commerce_event", "Eventos comerciales"],
] as const;

const guardLabels: Record<string, string> = {
  catalog_item_inactive: "producto retirado",
  product_archived: "producto archivado",
  product_not_active: "producto no activo",
  storefront_inactive: "tienda inactiva",
  stock_unavailable: "stock agotado",
  price_not_positive: "precio inválido",
  price_currency_invalid: "moneda inválida",
  public_url_not_public: "URL pública no disponible",
  image_url_not_public: "imagen comercial no pública",
  creative_media_not_public: "creativo no público",
  instagram_public_image_required: "Instagram requiere una imagen pública",
  promotion_expired: "promoción vencida",
  commercial_facts_changed: "cambió la información comercial",
};

function guardLabel(code: string) {
  return guardLabels[code] || code;
}

async function responseBody(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { detail: text };
  }
}

function errorMessage(body: Record<string, unknown>, fallback: string) {
  const rawDetail = body.detail;
  const detailObject = rawDetail && typeof rawDetail === "object" ? rawDetail as Record<string, unknown> : null;
  const detail = detailObject ? String(detailObject.code || "") : String(rawDetail || "");
  const blockers = detailObject && Array.isArray(detailObject.blockers)
    ? detailObject.blockers.map((item) => String(item))
    : [];
  const messages: Record<string, string> = {
    marketing_commerce_bridge_disabled: "El puente Commerce esta instalado, pero sigue apagado para esta etapa.",
    marketing_commerce_import_disabled: "La importacion Commerce sigue apagada.",
    marketing_commerce_service_not_configured: "Falta configurar la conexion interna con Commerce.",
    marketing_commerce_service_unavailable: "Commerce no respondio. Intenta nuevamente.",
    marketing_commerce_subject_stale: "La evidencia comercial cambio. El borrador quedo bloqueado para una nueva revision.",
    marketing_commerce_editorial_changed: "El copy o creativo cambio despues de aprobarse. Solicita una nueva aprobacion.",
    marketing_commerce_editorial_not_pending: "El contenido debe enviarse a aprobacion antes de aprobarlo.",
    marketing_commerce_editorial_not_approved: "El contenido debe estar aprobado antes de programarlo.",
    marketing_commerce_publish_disabled: "La publicacion Commerce esta instalada, pero el flag productivo sigue apagado.",
    marketing_commerce_destination_not_connected: "Conecta y valida el canal en BetterP antes de usarlo como destino.",
    marketing_commerce_publication_requires_reconciliation: "El proveedor recibio un intento con resultado ambiguo. Debe reconciliarse antes de reintentar.",
    marketing_commerce_publication_guard_blocked: "La verdad comercial bloquea esta publicacion.",
    marketing_permission_denied: "Tu rol no permite ejecutar esta accion de Marketing Commerce.",
  };
  const base = detail.startsWith("marketing_permission_denied:")
    ? messages.marketing_permission_denied
    : messages[detail] || detail || fallback;
  return blockers.length ? `${base} Motivos: ${blockers.map(guardLabel).join(", ")}.` : base;
}

function stableCommandKey(action: string, value: unknown) {
  const input = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `editorial:${action}:${(hash >>> 0).toString(16)}`;
}

export default function CommerceSubjectSelector({ entityId }: { entityId: number | null }) {
  const [data, setData] = useState<SelectorResponse | null>(null);
  const [storefrontId, setStorefrontId] = useState<number | null>(null);
  const [subjectType, setSubjectType] = useState("catalog_item");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [workflow, setWorkflow] = useState<EditorialWorkflow | null>(null);
  const [editorialTitle, setEditorialTitle] = useState("");
  const [editorialCopy, setEditorialCopy] = useState("");
  const [editorialFormat, setEditorialFormat] = useState("MIXTO");
  const [editorialCtaText, setEditorialCtaText] = useState("");
  const [editorialCtaUrl, setEditorialCtaUrl] = useState("");
  const [editorialHashtags, setEditorialHashtags] = useState("");
  const [editorialMedia, setEditorialMedia] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [editorialAction, setEditorialAction] = useState("");
  const [selectedDestinations, setSelectedDestinations] = useState<string[]>([]);

  const selectWorkflow = (selected: EditorialWorkflow) => {
    setWorkflow(selected);
    setEditorialTitle(selected.editorial.title || "");
    setEditorialCopy(selected.editorial.copy || "");
    setEditorialFormat(selected.editorial.format || "MIXTO");
    setEditorialCtaText(selected.editorial.cta_text || "");
    setEditorialCtaUrl(selected.editorial.cta_url || "");
    setEditorialHashtags((selected.editorial.hashtags || []).join(", "));
    setEditorialMedia((selected.editorial.media_urls || []).join("\n"));
    setScheduledAt(selected.scheduled_at ? selected.scheduled_at.slice(0, 16) : "");
    setSelectedDestinations(selected.destinations.map((destination) => destination.channel));
  };

  const load = useCallback(async () => {
    if (!entityId) return;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ subject_type: subjectType, page: String(page), page_size: "12" });
    if (storefrontId) params.set("storefront_id", String(storefrontId));
    if (appliedSearch) params.set("search", appliedSearch);
    try {
      const response = await fetch(
        buildApiUrl(`/marketing/entidades/${entityId}/commerce/sujetos/?${params.toString()}`),
        { cache: "no-store" }
      );
      const body = await responseBody(response);
      if (!response.ok) throw new Error(errorMessage(body, "No se pudieron cargar los sujetos Commerce."));
      const selector = body as unknown as SelectorResponse;
      setData(selector);
      if (!storefrontId && selector.selected_storefront_id) setStorefrontId(selector.selected_storefront_id);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar los sujetos Commerce.");
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, entityId, page, storefrontId, subjectType]);

  useEffect(() => {
    setPage(1);
    setStorefrontId(null);
    setData(null);
  }, [entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const applySearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  };

  const importSubject = async (subject: Subject) => {
    if (!entityId || !storefrontId) return;
    const key = `${subject.subject_type}:${subject.subject_id}`;
    setImporting(key);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        buildApiUrl(`/marketing/entidades/${entityId}/commerce/sujetos/importar/`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storefront_id: storefrontId,
            subject_type: subject.subject_type,
            subject_id: subject.subject_id,
            idempotency_key: `selector:${entityId}:${storefrontId}:${subject.subject_type}:${subject.subject_id}:v${subject.subject_version}`,
          }),
        }
      );
      const body = await responseBody(response);
      if (!response.ok) throw new Error(errorMessage(body, "No se pudo importar el sujeto."));
      setNotice(body.replay ? "Este sujeto ya estaba importado; se conservo la misma evidencia." : "Sujeto importado y firma verificada. No se creo ninguna publicacion.");
      await load();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "No se pudo importar el sujeto.");
    } finally {
      setImporting("");
    }
  };

  const prepareEditorial = async (subject: ImportedSubject) => {
    if (!entityId) return;
    setEditorialAction(`prepare:${subject.id}`);
    setError("");
    try {
      const payload = {
        subject_id: subject.id,
        idempotency_key: `prepare:${entityId}:${subject.snapshot_id}`,
      };
      const response = await fetch(buildApiUrl(`/marketing/entidades/${entityId}/commerce/editorial/preparar/`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(errorMessage(body, "No se pudo preparar el contenido."));
      selectWorkflow(body.workflow as EditorialWorkflow);
      setNotice("Borrador creado desde la evidencia. Aun no existen destinos ni publicaciones.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No se pudo preparar el contenido.");
    } finally {
      setEditorialAction("");
    }
  };

  const editorialRequest = async (action: string, path: string, payload: Record<string, unknown>, method = "POST") => {
    if (!workflow) return;
    setEditorialAction(action);
    setError("");
    setNotice("");
    try {
      const response = await fetch(buildApiUrl(path), {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(errorMessage(body, "No se pudo actualizar el flujo editorial."));
      selectWorkflow(body.workflow as EditorialWorkflow);
      setNotice(String(body.message || "Flujo editorial actualizado."));
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No se pudo actualizar el flujo editorial.");
    } finally {
      setEditorialAction("");
    }
  };

  const saveDraft = async () => {
    if (!workflow) return;
    const draft = {
      title: editorialTitle.trim(),
      copy_text: editorialCopy.trim(),
      format: editorialFormat,
      cta_text: editorialCtaText.trim(),
      cta_url: editorialCtaUrl.trim(),
      hashtags: editorialHashtags.split(",").map((item) => item.trim().replace(/^#/, "")).filter(Boolean),
      media_urls: editorialMedia.split("\n").map((item) => item.trim()).filter(Boolean),
    };
    await editorialRequest(
      "save",
      `/marketing/commerce/editorial/${workflow.id}/borrador/`,
      { ...draft, idempotency_key: stableCommandKey("save", { workflow: workflow.id, ...draft }) },
      "PUT"
    );
  };

  const saveDestinations = async () => {
    if (!workflow) return;
    await editorialRequest(
      "destinations",
      `/marketing/commerce/editorial/${workflow.id}/destinos/`,
      {
        channels: selectedDestinations,
        idempotency_key: stableCommandKey("destinations", {
          workflow: workflow.id,
          approval: workflow.approval_hash,
          channels: [...selectedDestinations].sort(),
        }),
      },
      "PUT"
    );
  };

  const publishDestination = async (channel: string) => {
    if (!workflow) return;
    await editorialRequest(
      `publish:${channel}`,
      `/marketing/commerce/editorial/${workflow.id}/publicar/${channel}/`,
      {
        idempotency_key: stableCommandKey("publish", {
          workflow: workflow.id,
          approval: workflow.approval_hash,
          channel,
        }),
      }
    );
  };

  const importedKeys = new Set((data?.imports || []).map((item) => `${item.subject_type}:${item.subject_id}:${item.subject_version}`));
  const pagination = data?.preview.pagination;
  const hasPermission = (permission: string) => Boolean(data?.operations?.permissions[permission]?.allowed);
  const permissionReason = (permission: string) => data?.operations?.permissions[permission]?.reason || "";
  const quotaAvailable = (key: string) => {
    const item = data?.operations?.usage_limits.items.find((candidate) => candidate.key === key);
    return !item || item.unlimited || (item.remaining ?? 0) > 0;
  };
  const canImport = hasPermission("marketing_subject.import") && quotaAvailable("marketing_commerce_snapshots");
  const canWriteEditorial = hasPermission("marketing_editorial.write");
  const canApprove = hasPermission("marketing_editorial.approve");
  const canPublish = hasPermission("marketing_publication.publish");

  return (
    <section className="space-y-5 rounded-3xl border border-cyan-500/20 bg-zinc-950/70 p-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Puente Commerce</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Seleccionar evidencia comercial</h2>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">Consulta una pagina a la vez. Importar verifica la firma y guarda una copia inmutable; no crea campanas, comunicados ni publicaciones.</p>
      </div>

      {data?.operations ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]" aria-label="Estado operativo del puente Commerce">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">Acceso y capacidad</p>
            <p className="mt-2 text-sm text-zinc-200">Capacidad <code>{data.operations.capability.key}</code>: {data.operations.capability.available ? "disponible" : "apagada"}</p>
            <p className="mt-1 text-xs text-zinc-500">Importacion {data.operations.flags.import ? "habilitada" : "apagada"} · Publicacion {data.operations.flags.publish ? "habilitada" : "apagada"} · Rollout {data.operations.flags.rollout ? "en enforcement" : "apagado"}</p>
            {!canApprove ? <p className="mt-2 text-xs text-amber-300">La aprobacion requiere rol Owner/Admin.</p> : null}
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">Operacion</p>
            {data.operations.issues.length ? <ul className="mt-2 space-y-2">{data.operations.issues.map((issue) => <li key={issue.code} className={issue.severity === "error" ? "text-sm text-red-200" : "text-sm text-amber-200"}><strong>{issue.count} · {issue.title}.</strong> <span className="text-zinc-400">{issue.action}</span></li>)}</ul> : <p className="mt-2 text-sm text-emerald-300">Sin errores operativos pendientes.</p>}
          </div>
        </div>
      ) : null}

      {data?.operations?.deployment.recent_runs.length ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4" aria-label="Evidencia de despliegue Marketing Commerce">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">Despliegue gobernado</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {data.operations.deployment.recent_runs.map((run) => (
              <li key={run.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300">
                <strong className={run.status === "blocked" ? "text-amber-300" : "text-emerald-300"}>{run.phase} · {run.status}</strong>
                <span className="mt-1 block text-zinc-500">Tienda {run.storefront_id} · {run.dry_run ? "sin escritura" : "aplicado"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[1fr_1fr_2fr_auto]">
        <select className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white" value={storefrontId || ""} onChange={(event) => { setStorefrontId(Number(event.target.value) || null); setPage(1); }} aria-label="Tienda Commerce">
          <option value="">Selecciona tienda</option>
          {(data?.storefronts || []).map((storefront) => <option key={storefront.id} value={storefront.id}>{storefront.name} · {storefront.status}</option>)}
        </select>
        <select className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white" value={subjectType} onChange={(event) => { setSubjectType(event.target.value); setPage(1); }} aria-label="Tipo de sujeto">
          {subjectTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <form className="contents" onSubmit={applySearch}>
          <input className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o SKU" />
          <button className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-cyan-400" type="submit">Buscar</button>
        </form>
      </div>

      {error ? <p role="alert" aria-live="assertive" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p> : null}
      {notice ? <p role="status" aria-live="polite" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</p> : null}
      {loading ? <p className="text-sm text-zinc-400">Cargando pagina de Commerce...</p> : null}

      {!loading && data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.preview.subjects.map((subject) => {
            const imported = importedKeys.has(`${subject.subject_type}:${subject.subject_id}:${subject.subject_version}`);
            const key = `${subject.subject_type}:${subject.subject_id}`;
            return (
              <article key={key} className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
                <div className="flex items-start gap-3">
                  {subject.image?.url ? <Image src={subject.image.url} alt="" width={64} height={64} unoptimized loader={({ src }) => src} className="h-16 w-16 rounded-xl object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-zinc-800 text-xs text-zinc-500">Sin imagen</div>}
                  <div className="min-w-0 flex-1"><h3 className="truncate font-semibold text-white">{subject.title}</h3><p className="text-xs text-zinc-500">{subject.sku || subject.subject_type}</p></div>
                </div>
                <div className="mt-4 flex items-center justify-between text-sm"><span className="text-zinc-400">{subject.price ? `${subject.price.currency || ""} ${subject.price.amount || ""}` : "Sin precio aplicable"}</span><span className={subject.guards?.eligible ? "text-emerald-300" : "text-amber-300"}>{subject.guards?.eligible ? "Elegible" : "Con bloqueos"}</span></div>
                {subject.guards?.blockers?.length ? <p className="mt-2 text-xs text-amber-300">{subject.guards.blockers.map(guardLabel).join(", ")}</p> : null}
                <button type="button" title={!canImport ? permissionReason("marketing_subject.import") || "Cuota de snapshots agotada." : ""} disabled={!canImport || imported || importing === key || !subject.guards?.eligible} onClick={() => void importSubject(subject)} className="mt-4 w-full rounded-xl border border-cyan-500/40 px-3 py-2 text-sm font-semibold text-cyan-200 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:text-zinc-500">
                  {imported ? "Importado" : importing === key ? "Verificando..." : "Importar evidencia"}
                </button>
              </article>
            );
          })}
        </div>
      ) : null}

      {data && data.preview.subjects.length === 0 ? <p className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-400">No hay sujetos en esta pagina.</p> : null}
      {pagination ? <div className="flex items-center justify-between"><span className="text-sm text-zinc-500">Pagina {pagination.page} · {pagination.total} resultados</span><div className="flex gap-2"><button type="button" disabled={pagination.page <= 1 || loading} onClick={() => setPage((value) => Math.max(value - 1, 1))} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 disabled:opacity-40">Anterior</button><button type="button" disabled={!pagination.has_next || loading} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 disabled:opacity-40">Siguiente</button></div></div> : null}

      {data?.imports?.length ? <div><h3 className="text-sm font-semibold text-white">Evidencia importada recientemente</h3><ul className="mt-2 space-y-2">{data.imports.slice(0, 8).map((item) => <li key={item.snapshot_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-900 px-3 py-2 text-sm"><div><span className="text-zinc-300">{item.title || `${item.subject_type} ${item.subject_id}`}</span><span className="ml-2 text-xs text-emerald-300">{item.workflow?.status || item.status}</span></div>{item.workflow ? <button type="button" onClick={() => selectWorkflow(item.workflow as EditorialWorkflow)} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200">Abrir flujo</button> : <button type="button" disabled={editorialAction === `prepare:${item.id}`} onClick={() => void prepareEditorial(item)} className="rounded-lg border border-cyan-500/40 px-3 py-1.5 text-xs text-cyan-200 disabled:opacity-40">{editorialAction === `prepare:${item.id}` ? "Preparando..." : "Preparar contenido"}</button>}</li>)}</ul></div> : null}

      {workflow ? (
        <div className="space-y-4 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Flujo editorial</p><h3 className="mt-1 font-semibold text-white">Copy, creativo y aprobacion</h3></div><span className="rounded-full border border-violet-500/30 px-3 py-1 text-xs text-violet-200">{workflow.status}</span></div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs text-zinc-400">Titulo<input value={editorialTitle} onChange={(event) => setEditorialTitle(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white" /></label>
            <label className="text-xs text-zinc-400">Formato<select value={editorialFormat} onChange={(event) => setEditorialFormat(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"><option value="TEXTO">Texto</option><option value="IMAGEN">Imagen</option><option value="VIDEO">Video</option><option value="MIXTO">Mixto</option></select></label>
            <label className="md:col-span-2 text-xs text-zinc-400">Copy<textarea value={editorialCopy} onChange={(event) => setEditorialCopy(event.target.value)} rows={4} className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white" /></label>
            <label className="text-xs text-zinc-400">Texto del CTA<input value={editorialCtaText} onChange={(event) => setEditorialCtaText(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white" /></label>
            <label className="text-xs text-zinc-400">URL del CTA<input value={editorialCtaUrl} onChange={(event) => setEditorialCtaUrl(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white" /></label>
            <label className="text-xs text-zinc-400">Hashtags separados por coma<input value={editorialHashtags} onChange={(event) => setEditorialHashtags(event.target.value)} className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white" /></label>
            <label className="text-xs text-zinc-400">Multimedia, una URL por linea<textarea value={editorialMedia} onChange={(event) => setEditorialMedia(event.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white" /></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!canWriteEditorial || Boolean(editorialAction) || workflow.status === "scheduled"} onClick={() => void saveDraft()} className="rounded-xl border border-zinc-600 px-4 py-2 text-sm text-white disabled:opacity-40">Guardar borrador</button>
            <button type="button" disabled={!canWriteEditorial || Boolean(editorialAction) || workflow.status !== "draft"} onClick={() => void editorialRequest("submit", `/marketing/commerce/editorial/${workflow.id}/solicitar-aprobacion/`, { idempotency_key: stableCommandKey("submit", workflow.content_hash) })} className="rounded-xl border border-amber-500/40 px-4 py-2 text-sm text-amber-200 disabled:opacity-40">Solicitar aprobacion</button>
            <button type="button" title={!canApprove ? permissionReason("marketing_editorial.approve") : ""} disabled={!canApprove || Boolean(editorialAction) || workflow.status !== "pending_approval"} onClick={() => void editorialRequest("approve", `/marketing/commerce/editorial/${workflow.id}/aprobar/`, { idempotency_key: stableCommandKey("approve", workflow.content_hash) })} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-40">Aprobar y revalidar</button>
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t border-zinc-800 pt-4"><label className="text-xs text-zinc-400">Fecha y hora<input disabled={!canWriteEditorial} type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className="mt-1 block rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white disabled:opacity-50" /></label><button type="button" disabled={!canWriteEditorial || Boolean(editorialAction) || workflow.status !== "approved" || !scheduledAt} onClick={() => void editorialRequest("schedule", `/marketing/commerce/editorial/${workflow.id}/programar/`, { scheduled_at: new Date(scheduledAt).toISOString(), idempotency_key: stableCommandKey("schedule", { hash: workflow.approval_hash, scheduledAt }) })} className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Programar tras revalidar</button><p className="text-xs text-zinc-500">Programar sólo agrega el contenido al calendario; no lo publica.</p></div>
          <div className="space-y-3 border-t border-zinc-800 pt-4">
            <div><p className="text-sm font-semibold text-white">Destinos sociales existentes</p><p className="mt-1 text-xs text-zinc-500">Sólo se aceptan canales activos y conectados en BetterP. Guardarlos no publica.</p></div>
            <div className="flex flex-wrap items-center gap-3">
              {["FACEBOOK", "INSTAGRAM"].map((channel) => <label key={channel} className="flex items-center gap-2 rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-300"><input type="checkbox" checked={selectedDestinations.includes(channel)} disabled={!canPublish || !(["approved", "scheduled"] as string[]).includes(workflow.status)} onChange={(event) => setSelectedDestinations((current) => event.target.checked ? [...new Set([...current, channel])] : current.filter((item) => item !== channel))} />{channel}</label>)}
              <button type="button" disabled={!canPublish || Boolean(editorialAction) || !(["approved", "scheduled"] as string[]).includes(workflow.status) || selectedDestinations.length === 0} onClick={() => void saveDestinations()} className="rounded-xl border border-cyan-500/40 px-4 py-2 text-sm text-cyan-200 disabled:opacity-40">Guardar destinos</button>
            </div>
            {workflow.destinations.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {workflow.destinations.map((destination) => (
                  <div key={destination.id} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                    <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-white">{destination.channel}</span><span className="text-xs text-zinc-400">{destination.status}</span></div>
                    {destination.remote_url ? <a href={destination.remote_url} target="_blank" rel="noreferrer" className="mt-2 block truncate text-xs text-cyan-300">{destination.remote_url}</a> : null}
                    {destination.guards?.blockers?.length ? <p className="mt-2 text-xs text-red-300">Bloqueos: {destination.guards.blockers.map(guardLabel).join(", ")}</p> : destination.guards?.eligible ? <p className="mt-2 text-xs text-emerald-300">Guardas comerciales aprobadas</p> : null}
                    {destination.guards?.warnings?.length ? <p className="mt-1 text-xs text-amber-300">Avisos: {destination.guards.warnings.map(guardLabel).join(", ")}</p> : null}
                    <div className="mt-3 flex items-center gap-2">
                      <button type="button" title={!canPublish ? permissionReason("marketing_publication.publish") : ""} disabled={!canPublish || Boolean(editorialAction) || destination.status === "PUBLICADA" || destination.status === "ERROR" || Boolean(destination.guards?.blockers?.length)} onClick={() => void publishDestination(destination.channel)} className="rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 disabled:opacity-40">{destination.status === "PUBLICADA" ? "Publicado" : destination.status === "ERROR" ? "Requiere conciliacion" : "Publicar una vez"}</button>
                      {destination.commerce_synced_at ? <span className="text-xs text-emerald-300">Referencia sincronizada</span> : destination.commerce_sync_error ? <span className="text-xs text-amber-300">Referencia pendiente</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
