import type { Metadata } from "next";

import Mesas from "@/components/pos/Mesas";

export const metadata: Metadata = { title: "Mesas" };

export default function MesasPage() {
  return <Mesas />;
}
