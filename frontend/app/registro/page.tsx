import { Suspense } from "react";

import PlanCheckoutRegistration from "@/components/marketing/PlanCheckoutRegistration";

export default function RegistroPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#050816]" />}>
      <PlanCheckoutRegistration />
    </Suspense>
  );
}
