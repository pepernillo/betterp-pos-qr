import type { Metadata } from "next";

import Caja from "@/components/pos/Caja";

export const metadata: Metadata = { title: "Caja" };

export default function CajaPage() {
  return <Caja />;
}
