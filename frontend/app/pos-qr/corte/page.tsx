import type { Metadata } from "next";

import Corte from "@/components/pos/Corte";

export const metadata: Metadata = { title: "Corte de caja" };

export default function CortePage() {
  return <Corte />;
}
