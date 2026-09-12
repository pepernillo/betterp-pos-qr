import type { Metadata } from "next";

import Tablero from "@/components/pos/Tablero";

export const metadata: Metadata = { title: "Tablero" };

export default function DashboardPage() {
  return <Tablero />;
}
