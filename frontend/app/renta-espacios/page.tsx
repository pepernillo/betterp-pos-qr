import { Suspense } from "react";

import RentaEspaciosOverview from "@/components/entidades/RentaEspaciosOverview";

export default function RentaEspaciosPage() {
  return (
    <Suspense fallback={null}>
      <RentaEspaciosOverview />
    </Suspense>
  );
}
