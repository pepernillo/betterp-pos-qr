import type { Metadata } from "next";

import PuntosVenta from "@/components/pos/PuntosVenta";

export const metadata: Metadata = { title: "Puntos de venta" };

export default function PuntosVentaPage() {
  return <PuntosVenta />;
}
