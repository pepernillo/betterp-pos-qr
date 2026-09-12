import type { Metadata } from "next";

import MenuPublico from "@/components/pos/MenuPublico";

export const metadata: Metadata = {
  title: "Menu",
  robots: { index: false, follow: false },
};

export default async function MenuPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <MenuPublico token={token} />;
}
