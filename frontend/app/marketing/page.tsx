import { Suspense } from "react";

import MarketingWorkspace from "@/components/marketing/MarketingWorkspace";

export default function MarketingPage() {
  return (
    <Suspense fallback={null}>
      <MarketingWorkspace />
    </Suspense>
  );
}
