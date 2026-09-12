export const runtime = "edge";

import EntidadWorkspace from "../../../components/entidades/EntidadWorkspace";

interface EntidadDetallePageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function EntidadDetallePage({
  params,
}: EntidadDetallePageProps) {
  const { id } = await params;

  return <EntidadWorkspace entidadId={id} />;
}
