export const runtime = "edge";

import SellerCommissionPortal from "@/components/business/SellerCommissionPortal";

export default async function SellerPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SellerCommissionPortal token={token} />;
}
