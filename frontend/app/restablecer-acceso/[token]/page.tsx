export const runtime = "edge";

import ResetPasswordClient from "./ResetPasswordClient";

interface ResetPasswordPageProps {
  params: Promise<{
    token: string;
  }>;
}

export default async function ResetPasswordPage({
  params,
}: ResetPasswordPageProps) {
  const { token } = await params;

  return <ResetPasswordClient token={token} />;
}
