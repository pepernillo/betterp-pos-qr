import type { Metadata } from "next";

import Catalogos from "@/components/pos/Catalogos";

export const metadata: Metadata = { title: "Catalogos" };

export default function CatalogosPage() {
  return <Catalogos />;
}
