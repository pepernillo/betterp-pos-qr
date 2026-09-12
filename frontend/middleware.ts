import { NextRequest, NextResponse } from "next/server";

const LEGACY_APP_HOSTS = new Set(["app.betterp.net"]);
const CANONICAL_HOST = "betterp.net";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase();

  if (!host || !LEGACY_APP_HOSTS.has(host)) {
    return NextResponse.next();
  }

  const targetUrl = request.nextUrl.clone();
  targetUrl.protocol = "https:";
  targetUrl.hostname = CANONICAL_HOST;
  targetUrl.port = "";

  return NextResponse.redirect(targetUrl, 301);
}
