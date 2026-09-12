import type { Metadata } from "next";

import Productos from "@/components/pos/Productos";

export const metadata: Metadata = { title: "Productos" };

export default function ProductosPage() {
  return <Productos />;
}
