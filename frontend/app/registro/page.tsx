import { Suspense } from "react";

import PlanCheckoutRegistration from "@/components/publico/PlanCheckoutRegistration";

export default function RegistroPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#050816]" />}>
      <PlanCheckoutRegistration />
    </Suspense>
  );
}
