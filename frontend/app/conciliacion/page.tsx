import { Suspense } from "react";

import ConciliacionBancoPanel from "@/components/finanzas/ConciliacionBancoPanel";

export default function ConciliacionPage() {
  return (
    <Suspense fallback={null}>
      <ConciliacionBancoPanel />
    </Suspense>
  );
}
