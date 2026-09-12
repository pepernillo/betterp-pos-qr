"use client";

import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";

import { buildApiUrl } from "@/lib/api";

type WebVitalMetric = {
  id: string;
  name: string;
  value: number;
  delta: number;
  rating?: string;
  navigationType?: string;
};

const ALLOWED_METRICS = new Set(["CLS", "FCP", "INP", "LCP", "TTFB"]);
const reportedMetricIds = new Set<string>();
const TOKENISH_SEGMENT = /^[a-f0-9-]{24,}$|^[A-Za-z0-9_-]{32,}$/;
const APP_ENV = process.env.NEXT_PUBLIC_APP_ENV || "production";
const BUILD_ID =
  process.env.NEXT_PUBLIC_BUILD_ID ||
  process.env.NEXT_PUBLIC_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_CF_PAGES_COMMIT_SHA ||
  "";

function normalizeVitalsPath(path: string): string {
  const cleanPath = (path || "/").split(/[?#]/)[0] || "/";
  const segments = cleanPath
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (/^\d+$/.test(segment)) {
        return ":id";
      }
      if (TOKENISH_SEGMENT.test(segment)) {
        return ":token";
      }
      return segment;
    });
  return `/${segments.join("/")}` || "/";
}

export default function WebVitalsReporter() {
  const pathname = usePathname();

  useReportWebVitals((metric: WebVitalMetric) => {
    const metricName = metric.name.toUpperCase();
    if (
      !ALLOWED_METRICS.has(metricName) ||
      !Number.isFinite(metric.value) ||
      reportedMetricIds.has(metric.id)
    ) {
      return;
    }
    reportedMetricIds.add(metric.id);

    const body = JSON.stringify({
      id: metric.id,
      name: metricName,
      value: metric.value,
      delta: metric.delta,
      rating: metric.rating || "unknown",
      navigation_type: metric.navigationType || "",
      path: normalizeVitalsPath(pathname || window.location.pathname || "/"),
      app_env: APP_ENV,
      build_id: BUILD_ID,
      visibility_state: document.visibilityState || "unknown",
    });
    const url = buildApiUrl("/billing/web-vitals/");
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(url, blob);
      return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  });

  return null;
}
