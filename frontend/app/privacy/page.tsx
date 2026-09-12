import type { Metadata } from "next";

import LegalPage from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Aviso de privacidad",
  description:
    "Aviso de privacidad de BetterP para clientes SaaS, usuarios, prospectos, integraciones y datos operados dentro de la plataforma.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Aviso de privacidad"
      updatedAt="19 de junio de 2026"
      intro="Este aviso explica como BetterP recopila, usa, conserva, protege y comparte datos personales relacionados con prospectos, clientes SaaS, usuarios de la plataforma, integraciones, comunicaciones de cobranza, portales de autoservicio y datos operativos administrados por nuestros clientes."
      sections={[
        {
          title: "Responsable y contacto",
          body: [
            "BetterP es una plataforma SaaS operada comercialmente bajo la marca BetterP para ayudar a negocios basados en espacios a administrar clientes, ocupacion, cobranza, pagos, gastos, publicaciones, comunicaciones, reportes e integraciones. La entidad responsable sera la indicada en la propuesta, contrato, factura o documentacion fiscal aplicable.",
            "Para dudas, solicitudes de privacidad, ejercicio de derechos ARCO, revocacion de consentimiento o limitacion de uso de datos, escribe a contacto@betterp.net.",
          ],
        },
        {
          title: "Datos que podemos tratar",
          body: [
            "Podemos tratar datos de identificacion y contacto como nombre, correo, telefono, empresa, cargo, rol, permisos, preferencias, credenciales de acceso, registros de autenticacion y actividad dentro de la plataforma.",
            "Tambien podemos tratar datos comerciales, fiscales y operativos relacionados con la cuenta, como planes, pagos, facturacion, RFC, regimen fiscal, domicilio fiscal, suscripciones, tickets, solicitudes de demo, mensajes de soporte, configuraciones, integraciones y eventos de uso.",
            "Cuando el cliente usa BetterP para operar su negocio, puede cargar datos de sus propios clientes, huespedes, residentes, usuarios, prospectos, proveedores o colaboradores, incluyendo datos de contacto, contratos, saldos, documentos, comprobantes, imagenes, publicaciones y comunicaciones.",
            "En el modulo de cobranza y autoservicio podemos tratar datos como telefono, correo, identificadores de cliente, cuentas por cobrar, importes, fechas de vencimiento, periodos de pago, referencias, enlaces seguros, consentimientos, respuestas de baja, historial de mensajes, estados de entrega, comprobantes, archivos, datos fiscales y bitacoras de acceso.",
            "BetterP no solicita datos personales sensibles como parte ordinaria del servicio. Si el cliente decide cargar datos sensibles, declara contar con autorizacion suficiente y asume la responsabilidad de tratarlos conforme a la ley y a su propio aviso de privacidad.",
          ],
        },
        {
          title: "Finalidades primarias",
          body: [
            "Usamos los datos para crear y administrar cuentas, autenticar usuarios, operar modulos contratados, prestar soporte, procesar pagos, emitir comprobantes, gestionar suscripciones, activar pruebas, prevenir abuso, mantener seguridad, registrar trazabilidad y cumplir obligaciones legales o contractuales.",
            "Tambien usamos datos para ejecutar instrucciones del cliente, como publicar contenido autorizado, sincronizar inventario, procesar comunicaciones, registrar pagos, generar reportes, enviar recordatorios, conectar plataformas externas y conservar historiales operativos.",
            "Cuando el cliente activa funciones de cobranza, usamos los datos necesarios para preparar mensajes transaccionales, validar plantillas aprobadas, aplicar reglas de envio, evitar duplicidad o contacto excesivo, registrar consentimiento, procesar comprobantes, actualizar saldos y permitir que el cliente final consulte su informacion en el portal de autoservicio.",
          ],
        },
        {
          title: "Finalidades secundarias",
          body: [
            "Podemos usar datos de contacto para enviar comunicaciones comerciales, actualizaciones del producto, invitaciones a demos, materiales de capacitacion o informacion sobre nuevos modulos, siempre permitiendo solicitar baja o limitacion cuando corresponda.",
            "Podemos usar informacion agregada o disociada para analisis, mejora del servicio, seguridad, rendimiento, diagnostico de errores, planeacion comercial y desarrollo de nuevas funcionalidades, sin identificar directamente a personas cuando no sea necesario.",
          ],
        },
        {
          title: "Cliente como responsable de sus datos",
          body: [
            "Respecto de los datos que el cliente captura sobre sus propios clientes finales, residentes, huespedes, proveedores o colaboradores, el cliente normalmente actua como responsable del tratamiento y BetterP como proveedor tecnologico o encargado, segun el uso configurado.",
            "El cliente debe contar con avisos de privacidad, consentimientos, contratos, bases legales y autorizaciones suficientes para cargar, consultar, procesar, comunicar, publicar o automatizar informacion dentro de BetterP.",
            "El cliente es responsable de que las carteras, importes, fechas, contratos, telefonos, correos, datos fiscales y politicas de cobranza que cargue o configure en BetterP sean correctos, vigentes, licitos y proporcionales a su relacion con sus propios clientes finales.",
            "BetterP tratara esos datos conforme a las instrucciones razonables del cliente, estos terminos, el presente aviso, medidas de seguridad aplicables y obligaciones legales que correspondan.",
          ],
        },
        {
          title: "Cobranza, WhatsApp y portal de autoservicio",
          body: [
            "BetterP puede facilitar comunicaciones transaccionales y operativas relacionadas con cobranza, pagos, vencimientos, periodos de gracia, comprobantes, facturacion, aclaraciones, estados de cuenta y acceso al portal de autoservicio.",
            "Estas comunicaciones pueden enviarse por medios como WhatsApp, correo electronico, telefono u otros canales registrados, siempre conforme a la configuracion del cliente, las plantillas aprobadas, las reglas tecnicas disponibles y la informacion cargada en la plataforma.",
            "El portal de autoservicio puede requerir autenticacion, codigo de un solo uso, enlace seguro o consentimiento previo para que el cliente final consulte su estado de cuenta, cargue comprobantes, actualice datos fiscales, solicite facturas o revise informacion relacionada con su cuenta.",
            "BetterP registra evidencias operativas como fecha, hora, canal, plantilla, destinatario, consentimiento, respuesta de baja, estado de entrega, errores, usuario que configuro el envio y bitacoras necesarias para trazabilidad, seguridad y cumplimiento.",
          ],
        },
        {
          title: "Consentimiento y limitacion de comunicaciones",
          body: [
            "Cuando una persona usuaria final acepta recibir comunicaciones de cobranza o autoservicio dentro del portal, BetterP registra la version del texto aceptado, fecha, hora y metadatos tecnicos razonables para acreditar esa aceptacion.",
            "El consentimiento del usuario final no sustituye las obligaciones del cliente BetterP frente a sus propios clientes, contratos, avisos de privacidad o regulaciones aplicables. El cliente debe asegurarse de contar con base legal suficiente antes de activar comunicaciones.",
            "Las personas pueden solicitar limitacion, revocacion o baja de comunicaciones por los mecanismos disponibles, por ejemplo respondiendo palabras como BAJA, STOP o NO ENVIAR cuando el cliente tenga habilitada esa opcion, o contactando al cliente responsable o a BetterP para canalizar la solicitud.",
          ],
        },
        {
          title: "Encargados, proveedores y transferencias",
          body: [
            "Para prestar el servicio podemos usar proveedores de infraestructura, base de datos, almacenamiento, correo, mensajeria, analitica tecnica, pasarelas de pago, facturacion, autenticacion, soporte y plataformas integradas autorizadas por el cliente.",
            "En funciones de cobranza, autoservicio, comprobantes, mensajeria o facturacion pueden intervenir proveedores como Meta/WhatsApp, proveedores de correo, almacenamiento, hosting, OCR o lectura visual, pasarelas de pago y proveedores autorizados de certificacion o facturacion.",
            "Algunos proveedores pueden operar fuera de Mexico. En esos casos, BetterP procura usar proveedores con practicas razonables de seguridad, confidencialidad y tratamiento de informacion acordes con el servicio contratado.",
            "No vendemos datos personales. Solo compartimos informacion cuando sea necesario para prestar el servicio, cumplir instrucciones del cliente, atender obligaciones legales, proteger derechos, investigar incidentes, prevenir fraude o responder requerimientos de autoridad competente.",
          ],
        },
        {
          title: "Integraciones externas",
          body: [
            "Cuando un usuario conecta servicios como Meta, WhatsApp, Mercado Libre, pasarelas de pago, bancos, correo, almacenamiento u otros proveedores, BetterP puede recibir identificadores, tokens, estados de conexion, permisos, publicaciones, mensajes, metricas, webhooks y eventos necesarios para operar la integracion.",
            "La informacion obtenida desde plataformas externas se usa para las funciones autorizadas por el usuario o cliente, como listar cuentas, consultar plantillas aprobadas, verificar numeros, preparar publicaciones, sincronizar datos, recibir mensajes, enviar comunicaciones, consultar estados, procesar pagos o conservar trazabilidad.",
            "El cliente puede revocar o modificar integraciones desde los mecanismos disponibles en BetterP o directamente con el proveedor externo cuando aplique.",
          ],
        },
        {
          title: "Lectura de comprobantes, OCR e inteligencia artificial",
          body: [
            "Cuando se cargan comprobantes, constancias fiscales, imagenes, capturas o documentos, BetterP puede usar reglas, OCR, lectura visual o servicios de inteligencia artificial para extraer texto, importes, fechas, referencias, datos fiscales o elementos utiles para la operacion.",
            "La lectura automatica puede requerir revision humana y no sustituye la validacion final del cliente, especialmente en conciliacion, facturacion, aplicacion de pagos, datos fiscales o correcciones de cartera.",
            "El cliente debe revisar la informacion extraida antes de usarla para decisiones operativas, contables, fiscales o de cobranza, y puede corregir datos cuando el sistema lo permita.",
          ],
        },
        {
          title: "Pagos y facturacion",
          body: [
            "Cuando se usen pasarelas de pago, BetterP puede recibir identificadores de cliente, suscripcion, checkout, estado de pago, plan, moneda, montos, fechas, estatus de factura y metadatos necesarios para activar, suspender o renovar el servicio.",
            "BetterP no busca almacenar datos completos de tarjetas bancarias. Esos datos son procesados por el proveedor de pagos conforme a sus propias politicas, certificaciones y terminos.",
            "Para emitir CFDI o comprobantes fiscales podemos tratar datos fiscales del cliente SaaS y conservar los comprobantes, XML, PDF, UUID, folios, estatus, eventos de emision o cancelacion y datos requeridos para cumplimiento fiscal.",
            "Los comprobantes de pago cargados por usuarios o clientes finales pueden contener datos bancarios parciales, referencias, montos, fechas, nombres, capturas o documentos. BetterP los usa para trazabilidad, validacion operativa, conciliacion y soporte conforme a la configuracion del cliente.",
          ],
        },
        {
          title: "Conservacion, bloqueo y eliminacion",
          body: [
            "Conservamos datos mientras la cuenta, prueba, relacion comercial, soporte o integracion se encuentre activa y durante el tiempo necesario para cumplir obligaciones legales, fiscales, contractuales, de seguridad, auditoria, defensa o prevencion de abuso.",
            "Los registros de consentimiento, comunicaciones de cobranza, estados de entrega, comprobantes, facturas, bitacoras de acceso y evidencias operativas pueden conservarse durante el tiempo necesario para acreditar instrucciones, atender aclaraciones, cumplir obligaciones legales o defender derechos.",
            "Al terminar la relacion, podemos conservar datos bloqueados o respaldos por el periodo necesario para responsabilidades legales u operativas. Despues de dicho periodo, la informacion podra eliminarse, disociarse o anonimizarse de forma razonable.",
          ],
        },
        {
          title: "Seguridad",
          body: [
            "Aplicamos controles razonables de seguridad administrativa, tecnica y organizacional, incluyendo autenticacion, permisos por rol, registros de actividad, cifrado o proteccion de credenciales cuando corresponde, segregacion de accesos y medidas de monitoreo.",
            "El cliente tambien debe proteger sus cuentas, usar contrasenas seguras, limitar accesos, retirar usuarios no autorizados y evitar cargar informacion innecesaria o excesiva.",
          ],
        },
        {
          title: "Derechos ARCO y revocacion",
          body: [
            "Las personas titulares pueden solicitar acceso, rectificacion, cancelacion u oposicion al tratamiento de sus datos personales, asi como revocar consentimiento o limitar el uso de sus datos, escribiendo a contacto@betterp.net.",
            "La solicitud debe incluir nombre, medio de contacto, descripcion clara del derecho que desea ejercer y documentos o elementos que permitan acreditar identidad o representacion. Atenderemos la solicitud conforme a los plazos y requisitos previstos por la legislacion mexicana aplicable.",
            "Cuando la solicitud se refiera a datos administrados por uno de nuestros clientes dentro de su propia operacion, podemos canalizarla o pedir informacion adicional para ubicar al responsable correspondiente.",
          ],
        },
        {
          title: "Cambios al aviso",
          body: [
            "Podemos actualizar este aviso para reflejar cambios legales, operativos, de seguridad, integraciones, proveedores o funcionalidades. Publicaremos la version vigente en este sitio y, cuando corresponda, podremos notificar cambios relevantes por correo o dentro de la plataforma.",
            "El uso continuo de BetterP despues de una actualizacion implica conocimiento de la version vigente, sin perjuicio de derechos que la ley reconozca a las personas titulares.",
          ],
        },
      ]}
    />
  );
}
