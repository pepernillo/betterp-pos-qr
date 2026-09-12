export const runtime = "edge";

import InvitationClient from "./InvitationClient";

interface InvitationPageProps {
  params: Promise<{
    token: string;
  }>;
}

export default async function InvitationPage({ params }: InvitationPageProps) {
  const { token } = await params;

  return <InvitationClient token={token} />;
}
