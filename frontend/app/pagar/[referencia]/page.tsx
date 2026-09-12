import type { Metadata } from "next";

import CobroPublico from "@/components/pos/CobroPublico";

export const metadata: Metadata = {
  title: "Pagar",
  robots: { index: false, follow: false },
};

export default async function PagarPage({
  params,
}: {
  params: Promise<{ referencia: string }>;
}) {
  const { referencia } = await params;
  return <CobroPublico referencia={referencia} />;
}
