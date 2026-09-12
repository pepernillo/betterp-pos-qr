import type { Metadata } from "next";

import LegalPage from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Politicas de uso y terminos del servicio",
  description:
    "Condiciones de uso de BetterP para clientes SaaS, usuarios, integraciones, pagos, prueba gratuita y politicas comerciales.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Politicas de uso y terminos del servicio"
      updatedAt="19 de junio de 2026"
      intro="Estos terminos regulan el acceso y uso de BetterP, plataforma SaaS para administrar negocios basados en espacios. Al crear una cuenta, iniciar una prueba, contratar un plan, aceptar una invitacion, usar el sistema, activar comunicaciones de cobranza o mantener una suscripcion activa, aceptas estas condiciones y las politicas vinculadas."
      sections={[
        {
          title: "Naturaleza del servicio",
          body: [
            "BetterP es una plataforma de software como servicio para centralizar informacion operativa de espacios, clientes, ocupacion, cobranza, gastos, conciliacion, publicaciones, comunicaciones, reportes e integraciones.",
            "BetterP no presta servicios legales, fiscales, contables, financieros, inmobiliarios, hoteleros ni de cobranza extrajudicial por cuenta del cliente. Las recomendaciones, reportes, automatizaciones o tableros son herramientas de apoyo operativo y no sustituyen la revision profesional que corresponda.",
            "El modulo de cobranza facilita organizacion, recordatorios, trazabilidad, comprobantes, conciliacion y autoservicio, pero no convierte a BetterP en acreedor, gestor de cobranza, mandatario, representante legal ni responsable de la relacion contractual entre el cliente y sus propios clientes finales.",
          ],
        },
        {
          title: "Cuenta, usuarios y autorizacion",
          body: [
            "La persona que registra o administra una cuenta declara tener facultades suficientes para representar al negocio, administrar sus datos, invitar usuarios, configurar permisos, conectar canales y contratar o cancelar servicios.",
            "Cada usuario debe proteger sus credenciales, usar informacion veraz y mantener actualizados sus datos de contacto. Las acciones realizadas desde una cuenta autenticada podran considerarse instrucciones validas del usuario o de la organizacion que representa.",
            "Los administradores son responsables de asignar roles adecuados, retirar accesos cuando un colaborador ya no deba ingresar y revisar periodicamente permisos, integraciones y configuraciones sensibles.",
          ],
        },
        {
          title: "Prueba gratuita, contratacion y planes",
          body: [
            "El free trial permite explorar funciones base de BetterP por el periodo publicado en el sitio o en la propuesta comercial. La prueba gratuita no implica activacion productiva completa, onboarding personalizado, integraciones avanzadas, desarrollos especiales ni soporte fuera del alcance indicado.",
            "Para continuar usando BetterP despues del periodo de prueba o para activar una cuenta productiva, el cliente debe contratar un plan vigente y completar el pago correspondiente. Los limites de usuarios, entidades, espacios, modulos, integraciones y soporte dependen del plan contratado.",
            "BetterP puede actualizar precios, planes, limites, beneficios o politicas comerciales. Los cambios aplicaran conforme a la propuesta aceptada, al ciclo de facturacion correspondiente o a la comunicacion que se entregue al cliente.",
          ],
        },
        {
          title: "Pagos recurrentes, cancelacion y devoluciones",
          body: [
            "Cuando un plan incluya cobros recurrentes, BetterP informara monto, periodicidad, medio de pago y condiciones aplicables antes de confirmar la contratacion. El cliente autoriza expresamente los cargos recurrentes al aceptar el checkout, contrato, propuesta o mecanismo de pago disponible.",
            "El cliente puede solicitar la cancelacion de su suscripcion por los canales habilitados. La cancelacion evita renovaciones futuras, sin afectar cargos devengados, servicios ya prestados, saldos pendientes o compromisos pactados por separado.",
            "Politica comercial de satisfaccion del primer mes: si durante los primeros 30 dias naturales desde la activacion pagada BetterP no cumple con el alcance SaaS contratado, el cliente puede solicitar cancelacion y devolucion del pago SaaS aplicable a ese primer periodo.",
            "La devolucion del primer mes no aplica cuando exista uso indebido, abuso, incumplimiento del cliente, falta de informacion necesaria, consumo extraordinario, implementacion especial, integraciones de terceros, desarrollos personalizados, servicios ya ejecutados, comisiones no recuperables o condiciones comerciales distintas pactadas por escrito.",
            "Los upgrades, downgrades, saldos a favor, reembolsos parciales o cambios de ciclo se administraran conforme a la configuracion de Stripe, la propuesta comercial y las reglas vigentes al momento del cambio.",
          ],
        },
        {
          title: "Comprobantes, CFDI y registros de pago",
          body: [
            "Los correos de pago recibido, estados de cuenta, acuses de comprobante, referencias, recibos internos o registros visibles en BetterP son constancias operativas del servicio y no sustituyen un CFDI ni una factura fiscal.",
            "Cuando el cliente requiera CFDI por la suscripcion BetterP, debera proporcionar datos fiscales correctos, regimen, uso CFDI y cualquier dato requerido por la normativa aplicable. La emision puede depender de que el pago este confirmado y de que la configuracion fiscal de BetterP este activa.",
            "Si el cliente opera facturacion para sus propios clientes finales dentro de BetterP, sera responsable de validar datos fiscales, conceptos, importes, impuestos, cancelaciones, complementos y cumplimiento frente a sus usuarios o autoridades.",
          ],
        },
        {
          title: "Uso permitido y restricciones",
          body: [
            "El cliente se obliga a usar BetterP de forma licita, segura y de buena fe. Queda prohibido usar la plataforma para fraude, suplantacion, spam, hostigamiento, envio de mensajes sin consentimiento, carga de contenido ilicito, violacion de derechos de terceros, evasion de controles, pruebas no autorizadas o afectacion de la infraestructura.",
            "El cliente es responsable de la informacion que capture, importe, publique, automatice o transmita, incluyendo datos de clientes finales, contratos, documentos, imagenes, precios, mensajes, politicas internas, anuncios y comprobantes.",
            "El cliente no debe usar BetterP para enviar comunicaciones intimidatorias, discriminatorias, falsas, abusivas, repetitivas, fuera de contexto, fuera de relacion comercial o contrarias a contratos, leyes, politicas de plataformas externas o derechos de los destinatarios.",
            "BetterP puede suspender, limitar o cancelar accesos cuando detecte riesgo de seguridad, uso abusivo, incumplimiento legal, falta de pago, orden de autoridad, afectacion a terceros o violacion de estos terminos.",
          ],
        },
        {
          title: "Modulo de cobranza y comunicaciones por WhatsApp",
          body: [
            "Cuando el cliente active el modulo de cobranza, acepta que BetterP funciona como herramienta tecnologica para preparar, enviar y registrar comunicaciones operativas o transaccionales relacionadas con saldos, vencimientos, periodos de gracia, comprobantes, facturacion, aclaraciones y autoservicio.",
            "El cliente es el unico responsable de la existencia, exactitud, vigencia y legalidad de los adeudos, contratos, importes, fechas, referencias, telefonos, correos, datos fiscales, reglas de negocio y politicas de cobranza que configure o cargue en BetterP.",
            "El cliente debe contar con base legal, consentimiento, relacion contractual, aviso de privacidad y autorizaciones suficientes para contactar a sus propios clientes finales por WhatsApp, correo, telefono u otros medios. BetterP puede solicitar confirmaciones, descargos o evidencias antes de habilitar automatizaciones.",
            "BetterP puede limitar el envio a plantillas aprobadas, listas seguras, ventanas de tiempo, maximos de frecuencia, validaciones de vencimiento, bloqueo por contacto reciente, consentimiento vigente, reglas de no contactar y revision manual. Estos controles reducen riesgo, pero no eliminan la responsabilidad del cliente sobre el uso correcto del sistema.",
            "Si el cliente usa un numero de WhatsApp administrado o compartido por BetterP, acepta que dicho uso queda sujeto a politicas de Meta/WhatsApp, limites de calidad, plantillas aprobadas, restricciones tecnicas y revision operativa. BetterP puede suspender envios si detecta riesgo de spam, quejas, mala calidad, falta de consentimiento, datos incorrectos o uso contrario a estos terminos.",
          ],
        },
        {
          title: "Consentimiento de clientes finales y portal de autoservicio",
          body: [
            "El portal de autoservicio puede solicitar a los clientes finales aceptar comunicaciones de cobranza y autoservicio antes de consultar saldos, cargar comprobantes, actualizar datos fiscales o solicitar facturas. BetterP registra la aceptacion, version del texto, fecha, hora y datos tecnicos razonables para trazabilidad.",
            "Ese consentimiento operativo no sustituye los avisos de privacidad, contratos, politicas internas, obligaciones de informacion ni autorizaciones que el cliente debe tener frente a sus propios clientes finales conforme a la ley aplicable.",
            "Cuando un destinatario solicite dejar de recibir comunicaciones, ejerza derechos de privacidad, desconozca el adeudo o reporte informacion incorrecta, el cliente debe atender la solicitud de forma oportuna. BetterP podra registrar respuestas como BAJA, STOP, NO ENVIAR o equivalentes y, segun la configuracion, bloquear nuevos envios.",
            "El cliente acepta revisar periodicamente su cartera, contactos, consentimientos y respuestas para evitar mensajes improcedentes, duplicados, excesivos o dirigidos a personas equivocadas.",
          ],
        },
        {
          title: "Datos del cliente y datos de terceros",
          body: [
            "El cliente conserva la responsabilidad sobre los datos personales y operativos que carga o administra en BetterP. Cuando el cliente trata datos de sus propios clientes, huespedes, residentes, usuarios, prospectos, proveedores o colaboradores, debe contar con las bases legales, avisos de privacidad, consentimientos y autorizaciones que correspondan.",
            "BetterP actua como proveedor tecnologico y, segun el caso, como encargado del tratamiento respecto de datos que el cliente sube para operar su negocio. BetterP tratara dicha informacion conforme a las instrucciones razonables del cliente, la politica de privacidad y las medidas de seguridad disponibles.",
            "El cliente no debe cargar datos personales sensibles salvo que sean estrictamente necesarios para su operacion, cuente con autorizacion suficiente y configure controles adecuados. BetterP puede requerir ajustes o eliminar informacion cuando exista riesgo legal, de seguridad o de cumplimiento.",
            "El cliente acepta sacar en paz y a salvo a BetterP frente a reclamaciones derivadas de informacion incorrecta, falta de consentimiento, uso indebido de datos de terceros, comunicaciones improcedentes, mensajes de cobranza enviados por instrucciones del cliente o incumplimientos del cliente frente a sus propios usuarios, salvo que el reclamo derive directamente de una conducta dolosa o negligencia grave imputable a BetterP.",
          ],
        },
        {
          title: "Integraciones y terceros",
          body: [
            "BetterP puede conectarse con servicios externos como pasarelas de pago, bancos, Meta, WhatsApp, Mercado Libre, plataformas de publicacion, correo, almacenamiento, facturacion u otros proveedores. Cada integracion depende de los permisos, disponibilidad, reglas, costos, revisiones y politicas del tercero correspondiente.",
            "Al conectar una cuenta externa, el cliente autoriza a BetterP a usar los permisos concedidos para ejecutar acciones configuradas o solicitadas, como sincronizar informacion, enviar mensajes, publicar contenido, consultar estados, recibir webhooks o registrar eventos.",
            "BetterP no controla ni garantiza la continuidad, aprobacion, alcance, tiempos de respuesta, sanciones, bloqueos, cambios de API, comisiones o decisiones comerciales de proveedores externos.",
            "En el caso de Meta/WhatsApp, el cliente reconoce que la aprobacion de plantillas, calidad del numero, limites de mensajeria, entrega, bloqueo de cuentas, cambios de politicas y tiempos de revision dependen de Meta y de la conducta de envio observada.",
          ],
        },
        {
          title: "Propiedad intelectual y licencia",
          body: [
            "BetterP, su codigo, diseno, marca, interfaces, procesos, documentacion, bases de conocimiento, automatizaciones, reportes, configuraciones generales y demas elementos de la plataforma son propiedad de sus titulares o licenciantes.",
            "El cliente recibe una licencia limitada, no exclusiva, revocable, no transferible y condicionada al pago y cumplimiento de estos terminos para usar BetterP durante la vigencia de su cuenta.",
            "El contenido, datos y materiales cargados por el cliente siguen siendo del cliente o de quien corresponda. El cliente concede a BetterP el derecho de procesarlos exclusivamente para operar, mantener, proteger, dar soporte y mejorar el servicio contratado.",
          ],
        },
        {
          title: "Disponibilidad, soporte y seguridad",
          body: [
            "BetterP busca mantener el servicio disponible y seguro, pero puede haber interrupciones por mantenimiento, actualizaciones, fallas tecnicas, cambios de terceros, incidentes de seguridad, fuerza mayor o eventos fuera de control razonable.",
            "El soporte se prestara por los canales y horarios publicados o pactados. Los tiempos de respuesta pueden variar segun plan, severidad, integraciones involucradas y disponibilidad de informacion proporcionada por el cliente.",
            "BetterP implementa controles razonables de seguridad, autenticacion, permisos, registros y proteccion de credenciales. Ningun sistema es infalible; el cliente tambien debe aplicar buenas practicas internas, contrasenas seguras y control de accesos.",
          ],
        },
        {
          title: "Responsabilidad y limites",
          body: [
            "BetterP no sera responsable por decisiones de negocio tomadas por el cliente, errores en datos capturados por usuarios, configuraciones incorrectas, mensajes enviados por el cliente, publicaciones rechazadas por terceros, falta de autorizacion sobre datos o contenido, ni por incumplimientos del cliente frente a sus propios usuarios, clientes, autoridades o proveedores.",
            "BetterP no sera responsable por cobros improcedentes, adeudos inexistentes, errores en montos, fechas, intereses, recargos, contratos, referencias de pago, comprobantes o datos de contacto cuando dichos datos hayan sido cargados, configurados, importados, corregidos o aprobados por el cliente o sus usuarios.",
            "En la medida permitida por la ley, BetterP no responde por perdidas indirectas, lucro cesante, perdida de negocio, perdida de datos por causa imputable al cliente, danos reputacionales o afectaciones derivadas de servicios externos. Cualquier responsabilidad directa se limitara al monto pagado por el cliente por el servicio SaaS durante los tres meses previos al evento que dio origen al reclamo, salvo disposicion legal obligatoria en contrario.",
          ],
        },
        {
          title: "Comunicaciones y medios electronicos",
          body: [
            "El cliente acepta que contratos, avisos, consentimientos, confirmaciones, instrucciones, mensajes, tickets, registros de actividad, comprobantes y comunicaciones puedan realizarse por medios electronicos, incluyendo correo, formularios, checkout, panel de usuario, webhooks o herramientas integradas.",
            "Los registros electronicos generados por BetterP podran usarse como evidencia operativa de accesos, configuraciones, pagos, autorizaciones, consentimientos, publicaciones, mensajes, estados de entrega, bajas, errores y acciones realizadas dentro del sistema.",
          ],
        },
        {
          title: "Cancelacion de cuenta, exportacion y respaldos",
          body: [
            "Al cancelar una cuenta, BetterP podra limitar el acceso al servicio al cierre del ciclo contratado o conforme a la solicitud procesada. El cliente debe descargar o solicitar exportacion de informacion necesaria antes de perder acceso operativo.",
            "BetterP puede conservar respaldos, bitacoras, comprobantes, facturas, eventos de pago, registros de seguridad y datos bloqueados durante el tiempo razonable para cumplir obligaciones legales, fiscales, contractuales, auditoria, soporte, defensa o prevencion de abuso.",
            "Las restauraciones puntuales, recuperaciones avanzadas, exportaciones especiales o trabajo manual fuera del alcance del plan pueden generar costos adicionales previa aceptacion del cliente.",
          ],
        },
        {
          title: "Ley aplicable y contacto",
          body: [
            "Estos terminos se interpretan conforme a las leyes aplicables en Mexico, sin perjuicio de normas obligatorias que resulten aplicables por domicilio, naturaleza del cliente o canal de contratacion.",
            "Para soporte, aclaraciones, cancelaciones, solicitudes comerciales, privacidad o asuntos relacionados con la cuenta, escribe a contacto@betterp.net.",
            "Estos terminos pueden complementarse con propuestas comerciales, ordenes de servicio, contratos, anexos de tratamiento de datos, politicas de privacidad, terminos de terceros o acuerdos especificos aceptados por el cliente.",
          ],
        },
      ]}
    />
  );
}
