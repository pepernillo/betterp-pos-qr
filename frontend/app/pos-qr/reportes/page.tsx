import type { Metadata } from "next";

import Reportes from "@/components/pos/Reportes";

export const metadata: Metadata = { title: "Reportes de venta" };

export default function ReportesPage() {
  return <Reportes />;
}
