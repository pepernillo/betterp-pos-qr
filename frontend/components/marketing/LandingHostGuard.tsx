"use client";

import { useEffect } from "react";

import { buildBetterPUrl, isLegacyBetterPAppHost } from "@/lib/solution-launch";

export default function LandingHostGuard() {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (isLegacyBetterPAppHost(window.location.hostname)) {
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.replace(buildBetterPUrl(currentPath));
    }
  }, []);

  return null;
}
