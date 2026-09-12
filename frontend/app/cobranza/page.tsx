import { Suspense } from "react";

import CobranzaWorkspace from "@/components/cobranza/CobranzaWorkspace";

export default function CobranzaPage() {
  return (
    <Suspense fallback={null}>
      <CobranzaWorkspace />
    </Suspense>
  );
}
