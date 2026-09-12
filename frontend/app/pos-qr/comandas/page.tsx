import type { Metadata } from "next";

import Comandas from "@/components/pos/Comandas";

export const metadata: Metadata = { title: "Comandas" };

export default function ComandasPage() {
  return <Comandas />;
}
