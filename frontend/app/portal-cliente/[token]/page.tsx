export const runtime = "edge";

import PortalClienteClient from "./PortalClienteClient";

interface PortalClientePageProps {
  params: Promise<{
    token: string;
  }>;
}

export default async function PortalClientePage({
  params,
}: PortalClientePageProps) {
  const { token } = await params;
  return <PortalClienteClient token={token} />;
}

