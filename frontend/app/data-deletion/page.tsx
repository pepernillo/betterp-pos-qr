import type { Metadata } from "next";

import LegalPage from "@/components/publico/LegalPage";

export const metadata: Metadata = {
  title: "Eliminacion de datos",
  description:
    "Instrucciones para solicitar eliminacion de datos asociados a BettERP y conexiones con Meta.",
};

export default function DataDeletionPage() {
  return (
    <LegalPage
      title="Eliminacion de datos de usuario"
      updatedAt="10 de mayo de 2026"
      intro="Esta pagina explica como solicitar la eliminacion de datos asociados a BettERP, incluyendo datos recibidos desde Meta cuando un usuario conecta Facebook, Instagram u otros servicios de Meta."
      sections={[
        {
          title: "Como solicitar eliminacion",
          body: [
            "Envia un correo a contacto@betterp.net con el asunto Solicitud de eliminacion de datos.",
            "Incluye el correo de tu cuenta BettERP, nombre de la empresa o entidad, y una descripcion clara de los datos o integraciones que deseas eliminar.",
            "Si la solicitud esta relacionada con Facebook o Instagram, indica tambien la pagina, cuenta o perfil conectado para poder ubicar la autorizacion correspondiente.",
          ],
        },
        {
          title: "Que datos podemos eliminar",
          body: [
            "Podemos eliminar o desvincular tokens de acceso, identificadores de cuenta, paginas conectadas, estados de integracion, registros de autorizacion y datos operativos que no deban conservarse por obligaciones legales o contractuales.",
            "Tambien podemos desactivar una integracion para impedir nuevas sincronizaciones o publicaciones desde BettERP.",
          ],
        },
        {
          title: "Plazos de atencion",
          body: [
            "Confirmaremos la recepcion de la solicitud y podremos pedir informacion adicional para validar identidad, autorizacion o alcance de la eliminacion.",
            "Atenderemos la solicitud en un plazo razonable de acuerdo con la complejidad tecnica, obligaciones legales y disponibilidad de informacion.",
          ],
        },
        {
          title: "Revocar permisos desde Meta",
          body: [
            "Tambien puedes retirar el acceso de BettERP desde la configuracion de tu cuenta de Facebook o Meta Business. Al revocar permisos, BettERP dejara de tener acceso nuevo a la informacion autorizada.",
            "Si revocas permisos directamente en Meta, escribe a contacto@betterp.net para que podamos actualizar el estado de la conexion dentro de BettERP si fuera necesario.",
          ],
        },
        {
          title: "Datos que podrian conservarse",
          body: [
            "Algunos registros pueden conservarse cuando sea necesario para cumplir obligaciones fiscales, contables, legales, auditoria, seguridad, prevencion de fraude o resolucion de disputas.",
            "Cuando no podamos eliminar completamente un dato por estas razones, limitaremos su uso a la finalidad que justifica su conservacion.",
          ],
        },
      ]}
    />
  );
}
