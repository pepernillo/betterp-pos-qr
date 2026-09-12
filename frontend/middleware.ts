import { NextRequest, NextResponse } from "next/server";

/**
 * Hosts historicos que deben terminar en el dominio canonico del segmento.
 * Configura CANONICAL_HOST con el dominio real antes de publicar.
 */
const LEGACY_HOSTS = new Set<string>([]);
const CANONICAL_HOST = process.env.NEXT_PUBLIC_CANONICAL_HOST || "";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();

  if (!host || !CANONICAL_HOST || !LEGACY_HOSTS.has(host)) {
    return NextResponse.next();
  }

  const target = request.nextUrl.clone();
  target.protocol = "https:";
  target.hostname = CANONICAL_HOST;
  target.port = "";
  return NextResponse.redirect(target, 301);
}
