import type { Metadata } from "next";

import Inventario from "@/components/pos/Inventario";

export const metadata: Metadata = { title: "Inventario" };

export default function InventarioPage() {
  return <Inventario />;
}
