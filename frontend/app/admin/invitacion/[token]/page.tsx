import PlatformAdminInvitationClient from "@/components/business/PlatformAdminInvitationClient";

export const runtime = "edge";

export default async function AdminInvitationAliasPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PlatformAdminInvitationClient token={token} />;
}
