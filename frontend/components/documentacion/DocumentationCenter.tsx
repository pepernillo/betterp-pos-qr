"use client";

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";

type SectionId =
  | "inicio"
  | "dashboard"
  | "entidades"
  | "renta"
  | "clientes"
  | "marketing"
  | "cobranza"
  | "cxc"
  | "cxp"
  | "conciliacion"
  | "configuracion"
  | "portal"
  | "comunicaciones"
  | "billing"
  | "cuenta"
  | "backoffice";

interface GuideSection {
  id: SectionId;
  eyebrow: string;
  title: string;
  summary: string;
  objective: string;
  items: string[];
  routine: string[];
  tips: string[];
}

const sections: GuideSection[] = [
  {
    id: "inicio",
    eyebrow: "Operacion",
    title: "Como entender BettERP",
    summary:
      "BettERP centraliza espacios, clientes, cargos, pagos, gastos, bancos y comunicacion para que el equipo trabaje con una sola fuente de informacion.",
    objective:
      "Reducir capturas duplicadas, ordenar la administracion diaria y dejar informacion lista para cobrar, pagar, conciliar y decidir.",
    items: [
      "Cada unidad de negocio agrupa sus espacios, clientes, reglas, cuentas y movimientos.",
      "Los cargos por cobrar nacen de asignaciones, rentas, cuotas o capturas manuales.",
      "Las cuentas por pagar permiten registrar compromisos operativos por entidad.",
      "La conciliacion conecta bancos con CxC y CxP para aplicar pagos con trazabilidad.",
      "El portal cliente reduce consultas repetidas porque muestra saldos, pagos, documentos y referencias.",
    ],
    routine: [
      "Revisar dashboard para detectar pendientes importantes.",
      "Actualizar disponibilidad y asignaciones de espacios.",
      "Registrar cargos, gastos o pagos del dia.",
      "Importar movimientos bancarios y conciliar pendientes.",
      "Consultar cartera, saldos y compromisos antes de cerrar el dia.",
    ],
    tips: [
      "Captura una vez y deja que los modulos compartan la informacion.",
      "Manten nombres de clientes, espacios y beneficiarios lo mas claros posible para mejorar conciliacion.",
      "Usa etiquetas, prioridades y fechas de vencimiento para ordenar el trabajo del equipo.",
    ],
  },
  {
    id: "dashboard",
    eyebrow: "Tablero",
    title: "Dashboard ejecutivo",
    summary:
      "Resume cartera, gastos, ocupacion, vacancia, clientes y actividad operativa para decidir que mover primero.",
    objective:
      "Dar una lectura viva del negocio sin entrar a cada modulo cuando solo necesitas priorizar cobranza, pagos, disponibilidad o riesgos.",
    items: [
      "Indicadores principales de facturacion activa, cartera abierta, compromisos y renta no capturada.",
      "Composicion de CxC, CxP e inventario para entender presion de caja y ocupacion.",
      "Rankings de clientes con mayor adeudo, pagos urgentes y entidades con mayor impacto economico.",
      "Lectura ejecutiva con prioridades de cobranza, pagos, captura disponible y riesgo operativo.",
      "Actualizacion manual y lectura de estado cuando alguna fuente no responde.",
    ],
    routine: [
      "Abrir el dashboard al inicio del dia para identificar prioridades.",
      "Atender primero vencidos, pagos urgentes y espacios disponibles con ingreso potencial.",
      "Usar los rankings para entrar al modulo correcto sin buscar manualmente.",
    ],
    tips: [
      "El tablero funciona mejor cuando CxC, CxP y espacios se mantienen al dia.",
      "Si un numero parece alto, entra al modulo origen para revisar detalle antes de operar.",
      "Usa la lectura ejecutiva como lista corta de decisiones, no como reemplazo de auditoria.",
    ],
  },
  {
    id: "entidades",
    eyebrow: "Portafolio",
    title: "Unidades de negocio",
    summary:
      "Administra propiedades, edificios, casas, condominios o cualquier operacion que tenga espacios, responsables y reglas propias.",
    objective:
      "Separar la operacion por entidad sin perder una vista consolidada del negocio.",
    items: [
      "Alta de entidades con datos generales, ciudad, tipo de operacion y estatus.",
      "Vista en tarjetas o tabla para revisar informacion y entrar al detalle.",
      "Resumen por entidad con ocupacion, CxC, CxP y comportamiento financiero.",
      "Configuracion local para reglas, conceptos, responsables y operacion interna.",
    ],
    routine: [
      "Crear la entidad antes de cargar espacios, clientes o movimientos.",
      "Revisar el resumen para detectar adeudos, gastos y disponibilidad.",
      "Usar la tabla cuando necesites filtrar, ordenar o comparar varias entidades.",
    ],
    tips: [
      "Usa nombres comerciales claros: ayudan a buscar, reportar y conciliar.",
      "Evita duplicar entidades para una misma operacion; usa espacios o tipos cuando aplique.",
      "Manten activa solo la operacion que realmente debe aparecer en reportes.",
    ],
  },
  {
    id: "renta",
    eyebrow: "Comercial",
    title: "Renta de espacios",
    summary:
      "Controla disponibilidad, asignaciones, entradas, salidas y publicacion de espacios desde una misma vista.",
    objective:
      "Saber que esta libre, ocupado o por vencer, y preparar la operacion para publicar en canales externos.",
    items: [
      "Catalogo de espacios por entidad: habitaciones, camas, departamentos, locales o unidades.",
      "Filtros por disponibilidad, entidad, tipo de espacio y busqueda.",
      "Asignacion de clientes con fechas, monto, moneda, deposito y reglas basicas.",
      "Configuracion de canales para conectar proveedores como Airbnb, Booking o Mercado Libre.",
      "Base para automatizar altas y bajas de anuncios cuando el espacio cambia de disponibilidad.",
    ],
    routine: [
      "Revisar primero disponibles para saber que se puede vender o publicar.",
      "Actualizar asignaciones cuando entra o sale un cliente.",
      "Validar reglas de precio, promocion o temporada antes de publicar en canales.",
    ],
    tips: [
      "Manten fotos, descripcion y atributos completos si el espacio se publicara en canales.",
      "Registra de que plataforma se genero la contratacion para medir el origen comercial.",
      "Usa reglas por proveedor para comisiones, promociones o temporada alta.",
    ],
  },
  {
    id: "clientes",
    eyebrow: "CRM",
    title: "Clientes",
    summary:
      "Concentra datos de residentes, huespedes, propietarios, responsables y contactos para que el equipo consulte la misma informacion.",
    objective:
      "Tener expediente administrativo y fiscal desde el inicio de la relacion con el cliente.",
    items: [
      "Datos generales, contacto, direccion, RFC y uso fiscal cuando aplique.",
      "Relacion con espacios, cargos, pagos, adeudos y documentos.",
      "Historial para entender que debe, que pago y que documentos se han generado.",
      "Informacion lista para portal cliente, facturacion y cobranza.",
    ],
    routine: [
      "Registrar el cliente antes de asignar un espacio cuando sea posible.",
      "Validar datos fiscales antes de emitir facturas.",
      "Actualizar correos y telefonos para mantener cobranza y portal funcionales.",
    ],
    tips: [
      "Evita crear el mismo cliente con variaciones de nombre.",
      "Cuando un pago viene con nombre distinto, registra alias o referencias para mejorar conciliacion.",
      "Mantener datos fiscales correctos evita retrabajo al facturar.",
    ],
  },
  {
    id: "marketing",
    eyebrow: "Comercial",
    title: "Marketing",
    summary:
      "Prepara comunicados, publicaciones programadas, calendario editorial y promocion de espacios disponibles desde una vista comercial.",
    objective:
      "Convertir inventario disponible y mensajes operativos en publicaciones ordenadas por canal, fecha y oportunidad.",
    items: [
      "Comunicados con texto, estado, formato, fecha programada y canales seleccionados.",
      "Calendario editorial para revisar publicaciones programadas por dia y hora.",
      "Tabla de espacios disponibles para crear comunicados desde inventario real.",
      "Conexiones de redes sociales visibles solo cuando estan configuradas para la capa.",
      "Metricas por canal para entender publicaciones, actividad y oportunidades de seguimiento.",
    ],
    routine: [
      "Revisar espacios disponibles antes de crear una publicacion.",
      "Programar comunicados con fecha, hora y canal correcto.",
      "Usar el calendario para evitar saturar redes o duplicar mensajes.",
      "Consultar metricas para detectar que publicaciones generan mas interes.",
    ],
    tips: [
      "Instagram requiere multimedia; no programes ese canal sin imagen valida.",
      "Mantener fichas de espacios completas mejora la calidad de las publicaciones.",
      "Usa mensajes por objetivo: disponibilidad, promocion, recordatorio o posicionamiento.",
    ],
  },
  {
    id: "cobranza",
    eyebrow: "Seguimiento",
    title: "Cobranza",
    summary:
      "Agrupa cartera vencida, clientes con adeudo, plantillas por etapa y seguimiento de mensajes sin repetir la configuracion tecnica de WhatsApp.",
    objective:
      "Dar al equipo una forma clara de contactar clientes segun vencimiento, riesgo y estado de pago.",
    items: [
      "Clientes con cuentas abiertas, saldos exigibles, dias de atraso y entidad relacionada.",
      "Plantillas genericas para recordatorio preventivo, vencimiento, atraso y restriccion operativa.",
      "Seleccion de canal disponible segun configuracion aprobada para la capa.",
      "Historial util de acciones para saber que se envio y que falta por resolver.",
      "Lectura por prioridad para separar cobranza preventiva de casos urgentes.",
    ],
    routine: [
      "Filtrar primero clientes vencidos o en gracia.",
      "Elegir la plantilla que corresponde a la etapa del proceso.",
      "Validar saldo y datos de contacto antes de enviar.",
      "Registrar seguimiento cuando el cliente responde o comparte comprobante.",
    ],
    tips: [
      "La conexion tecnica de WhatsApp vive en configuracion/backoffice; aqui solo se opera cobranza.",
      "Evita mensajes agresivos: usa textos claros, fechas y rutas de aclaracion.",
      "Ajusta plantillas por politica interna y mantenlas consistentes por entidad.",
    ],
  },
  {
    id: "cxc",
    eyebrow: "Cobranza",
    title: "Cuentas por cobrar",
    summary:
      "Organiza rentas, cuotas, recargos, servicios y saldos pendientes por cliente, espacio y entidad.",
    objective:
      "Saber quien debe, cuanto debe, por que concepto y que pagos ya fueron aplicados.",
    items: [
      "Cargos generados desde asignaciones o capturados manualmente.",
      "Estatus de pendiente, parcial, pagado o vencido.",
      "Relacion con cliente, espacio, entidad, periodo y fecha de vencimiento.",
      "Aplicacion de pagos desde conciliacion o validacion manual.",
      "Base para recordatorios, portal cliente y facturacion.",
    ],
    routine: [
      "Revisar vencimientos y saldos al iniciar el dia.",
      "Aplicar pagos conciliados y validar saldos pendientes.",
      "Dar seguimiento a clientes vencidos o pagos parciales.",
    ],
    tips: [
      "Usa conceptos claros para que el cliente entienda el cargo.",
      "Registra periodos consistentes para ordenar cartera mensual.",
      "Cuida montos y referencias: ayudan al motor de conciliacion.",
    ],
  },
  {
    id: "cxp",
    eyebrow: "Gastos",
    title: "Cuentas por pagar",
    summary:
      "Controla compromisos operativos y administrativos por entidad: renta, luz, internet, limpieza, servicios, nomina externa o reparaciones.",
    objective:
      "Anticipar pagos, priorizar gastos criticos y entender liquidez por operacion.",
    items: [
      "Alta rapida de gastos uno por uno.",
      "Carga batch para registrar gastos por entidad, concepto y monto.",
      "Beneficiario, banco, cuenta, CLABE, vencimiento, categoria y prioridad.",
      "Semaforo operativo para distinguir pagos criticos o con periodo de gracia.",
      "Conciliacion de retiros contra compromisos pendientes.",
    ],
    routine: [
      "Cargar compromisos recurrentes al inicio del periodo.",
      "Revisar vencimientos proximos y prioridades.",
      "Aplicar pagos cuando el retiro aparezca en banco.",
    ],
    tips: [
      "Entidad, concepto y monto son la base minima para ordenar el gasto.",
      "Agregar cuenta o CLABE mejora la conciliacion de retiros.",
      "Usa categorias simples y consistentes para reportes mas claros.",
    ],
  },
  {
    id: "conciliacion",
    eyebrow: "Banco",
    title: "Conciliacion bancaria",
    summary:
      "Importa estados de cuenta, revisa movimientos y aplica depositos o retiros contra CxC y CxP.",
    objective:
      "Reducir revision manual y dejar trazabilidad de que pago bancario cubre que adeudo o gasto.",
    items: [
      "Administracion de cuentas bancarias con validacion contra duplicados.",
      "Carga de estados de cuenta y resumen de saldos iniciales, finales, depositos y retiros.",
      "Tabla densa de movimientos con filtros, busqueda, orden y paginacion.",
      "Conciliacion automatica de pagos con coincidencias confiables.",
      "Pestana de sugerencias para revisar candidatos ambiguos antes de aplicar.",
    ],
    routine: [
      "Cargar el estado de cuenta del periodo.",
      "Ejecutar conciliacion de pendientes.",
      "Revisar sugerencias y aplicar manualmente las ambiguas.",
      "Validar movimientos sin candidato para mejorar referencias o datos maestros.",
    ],
    tips: [
      "Las coincidencias exactas por monto, nombre, referencia, cuenta o CLABE tienen mayor confianza.",
      "Si dos adeudos tienen el mismo monto y referencia poco clara, el sistema debe dejarlo para decision manual.",
      "Mientras mas limpios esten clientes, espacios y beneficiarios, mejor concilia el sistema.",
    ],
  },
  {
    id: "configuracion",
    eyebrow: "Global",
    title: "Configuracion del sistema",
    summary:
      "Concentra datos de negocio, facturacion, seguridad, suscripcion y preferencias visibles para el cliente sin exponer credenciales tecnicas.",
    objective:
      "Separar decisiones de negocio de configuraciones internas para que el cliente opere sin tocar tokens, webhooks o secretos.",
    items: [
      "Datos fiscales, datos de negocio, portal de clientes y reglas marco por capa.",
      "Seguridad y accesos para invitar usuarios, asignar roles y retirar permisos.",
      "Suscripcion y facturacion para revisar plan, ciclo, limites y estado de pago.",
      "Preferencias de canales y automatizacion disponibles sin mostrar llaves tecnicas.",
      "Accesos a configuraciones globales que aplican a todos los modulos de la capa.",
    ],
    routine: [
      "Completar datos de negocio y fiscales al iniciar la cuenta.",
      "Revisar usuarios activos y roles cuando cambia el equipo.",
      "Consultar suscripcion y limites antes de crecer unidades, espacios o usuarios.",
    ],
    tips: [
      "Las credenciales de proveedores deben vivir en backoffice o configuracion tecnica controlada.",
      "Usa roles conservadores: no todos los usuarios necesitan acceso administrativo.",
      "Mantener datos fiscales correctos evita errores en facturacion y comprobantes.",
    ],
  },
  {
    id: "portal",
    eyebrow: "Autoservicio",
    title: "Portal cliente",
    summary:
      "Permite que clientes consulten saldos, referencias, pagos, historial y documentos desde un link conectado al sistema.",
    objective:
      "Reducir mensajes repetidos a administracion y dar claridad al cliente sobre su cuenta.",
    items: [
      "Consulta de saldos y cargos pendientes.",
      "Historial de pagos y documentos relacionados.",
      "Acceso mediante liga segura del sistema.",
      "Base para facturas, comprobantes y seguimiento de pagos.",
    ],
    routine: [
      "Compartir el acceso cuando el expediente del cliente este completo.",
      "Usarlo como primer canal para dudas de saldo o referencias.",
      "Validar que los cargos publicados esten correctos antes de enviar recordatorios.",
    ],
    tips: [
      "El portal funciona mejor cuando CxC y pagos estan actualizados.",
      "Manten nombres y conceptos comprensibles para el cliente final.",
      "Evita resolver por chat lo que el cliente puede consultar en su portal.",
    ],
  },
  {
    id: "comunicaciones",
    eyebrow: "Mensajeria",
    title: "WhatsApp, comprobantes y automatizacion",
    summary:
      "Captura mensajes, comprobantes, quejas, solicitudes y pagos desde canales conectados para alimentar la operacion.",
    objective:
      "Convertir mensajes operativos en informacion trazable dentro del sistema.",
    items: [
      "Recepcion de comprobantes por WhatsApp cuando el canal esta conectado.",
      "Extraccion de datos para apoyar validacion y conciliacion.",
      "Registro de solicitudes o casos que pueden convertirse en seguimiento operativo.",
      "Historial de mensajes y evidencias para auditoria interna.",
    ],
    routine: [
      "Configurar canales permitidos por capa de negocio.",
      "Revisar evidencias entrantes antes de aplicar pagos cuando exista duda.",
      "Usar mensajes salientes para recordatorios y confirmaciones.",
    ],
    tips: [
      "Define textos claros para que el cliente envie referencia, monto y comprobante.",
      "Controla el consumo de operaciones inteligentes y mensajes desde billing.",
      "Activa alertas cuando el uso suba demasiado para evitar costos inesperados.",
    ],
  },
  {
    id: "billing",
    eyebrow: "Cuenta",
    title: "Plan, extras y consumo",
    summary:
      "Muestra el plan contratado y el estado de cuenta de extras como operaciones inteligentes, comprobantes, timbres y mensajes.",
    objective:
      "Que el cliente entienda que incluye su plan y que consumo adicional se esta generando.",
    items: [
      "Resumen del plan mensual o anual.",
      "Extras del periodo visibles sin exponer detalles tecnicos como tokens.",
      "Operaciones inteligentes medidas como acciones de valor para el negocio.",
      "Timbres de facturacion y comprobantes WhatsApp como consumos trazables.",
      "Alertas preventivas cuando el uso se acerque o exceda lo incluido.",
    ],
    routine: [
      "Revisar el estado de cuenta de extras al cierre de cada periodo.",
      "Confirmar que consumos altos correspondan a actividad real.",
      "Ajustar plan cuando el uso recurrente supere lo incluido.",
    ],
    tips: [
      "Cobra extras con margen razonable y comunica el valor de la operacion, no el costo tecnico.",
      "Usa alertas para que el cliente sepa cuando esta por generar cargos adicionales.",
      "En planes anuales, muestra el plan como cubierto y solo resume extras del periodo.",
    ],
  },
  {
    id: "cuenta",
    eyebrow: "Acceso",
    title: "Cuenta de usuario",
    summary:
      "Permite revisar datos personales de acceso, correo, seguridad, recuperacion y sesion activa del usuario.",
    objective:
      "Que cada usuario mantenga su acceso claro y seguro sin mezclarlo con la configuracion de negocio.",
    items: [
      "Datos basicos del usuario autenticado.",
      "Cambio o recuperacion de contrasena cuando aplica.",
      "Estado de acceso ligado a la capa de negocio activa.",
      "Salida segura de sesion desde el menu de usuario.",
      "Base para accesos por invitacion y autenticacion con Google.",
    ],
    routine: [
      "Usar un correo real y vigente para invitaciones y recuperacion.",
      "Cerrar sesion en equipos compartidos.",
      "Solicitar retiro de acceso si el usuario ya no participa en la operacion.",
    ],
    tips: [
      "La cuenta de usuario no sustituye los datos fiscales o comerciales de la empresa.",
      "Google facilita acceso, pero los permisos siguen dependiendo del rol asignado en BetterP.",
      "Evita compartir usuarios; invita a cada persona con su propio correo.",
    ],
  },
  {
    id: "backoffice",
    eyebrow: "Interno",
    title: "Backoffice del negocio",
    summary:
      "Espacio interno para administracion BetterP: suscriptores SaaS, planes, solicitudes, marketing, ventas, pagos y configuraciones de plataforma.",
    objective:
      "Mantener separada la operacion interna de BetterP de las apps que usan los clientes finales.",
    items: [
      "Dashboard privado de suscriptores, ingresos, solicitudes y operacion SaaS.",
      "Gestion de planes, price IDs, modo prueba/live y pasarela Stripe.",
      "Ventas BetterP con vendedores, atribucion comercial, costos, utilidad y comisiones.",
      "Configuracion tecnica de integraciones como Meta, WhatsApp, correo y webhooks.",
      "Seguimiento de prospectos, solicitudes de demo y casos internos de soporte.",
    ],
    routine: [
      "Revisar solicitudes y pagos pendientes desde el dashboard interno.",
      "Mantener planes y price IDs alineados con Stripe antes de vender.",
      "Registrar configuraciones tecnicas fuera de las vistas del cliente final.",
    ],
    tips: [
      "Nada tecnico sensible debe exponerse en modulos de cliente.",
      "Usa modo prueba para validar checkout antes de activar cambios en produccion.",
      "Backoffice es para BetterP; la operacion del cliente vive en las apps principales.",
    ],
  },
];

function sectionButtonClasses(active: boolean) {
  return `rounded-2xl border px-4 py-3 text-left text-sm transition-colors ${
    active
      ? "border-cyan-500/25 bg-cyan-500/10 text-white"
      : "border-white/8 bg-zinc-950/60 text-zinc-400 hover:border-zinc-700 hover:text-white"
  }`;
}

function MiniIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8.5A3.5 3.5 0 0 1 5 16z" />
      <path d="M8.5 8H15" />
      <path d="M8.5 12H16" />
      <path d="M8.5 16H14" />
    </svg>
  );
}

export default function DocumentationCenter() {
  const { user } = useAuth();
  const [activeId, setActiveId] = useState<SectionId>("inicio");
  const visibleSections = useMemo(
    () =>
      sections.filter(
        (section) => section.id !== "backoffice" || user?.is_platform_admin
      ),
    [user?.is_platform_admin]
  );
  const activeSection = useMemo(
    () =>
      visibleSections.find((section) => section.id === activeId) ??
      visibleSections[0] ??
      sections[0],
    [activeId, visibleSections]
  );

  useEffect(() => {
    if (!visibleSections.some((section) => section.id === activeId)) {
      setActiveId(visibleSections[0]?.id ?? "inicio");
    }
  }, [activeId, visibleSections]);

  return (
    <main className="min-h-screen bg-[#05070d] px-4 py-6 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="rounded-[28px] border border-white/8 bg-zinc-950/80 p-5 shadow-2xl shadow-black/20 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <span className="inline-flex rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.24em] text-cyan-200">
                Guia del sistema
              </span>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Documentacion operativa de BettERP
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400 sm:text-base">
                Una guia practica para entender como se conectan las apps,
                que revisar cada dia y como mantener la operacion ordenada sin
                depender de hojas separadas o configuraciones duplicadas.
              </p>
            </div>

            <div className="grid gap-2 rounded-3xl border border-white/8 bg-zinc-900/60 p-4 text-sm text-zinc-300 sm:min-w-80">
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                Recomendacion
              </p>
              <p className="leading-6">
                Usa esta vista para capacitacion interna, onboarding de nuevos
                usuarios y soporte durante demos.
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-[28px] border border-white/8 bg-zinc-950/80 p-3 lg:sticky lg:top-24 lg:self-start">
            <div className="px-2 py-3">
              <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                Apps y modulos
              </p>
            </div>
            <div className="grid gap-2">
              {visibleSections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveId(section.id)}
                  className={sectionButtonClasses(section.id === activeId)}
                >
                  <span className="block text-[10px] uppercase tracking-[0.22em] text-cyan-300/80">
                    {section.eyebrow}
                  </span>
                  <span className="mt-1 block font-medium">{section.title}</span>
                </button>
              ))}
            </div>
          </aside>

          <article className="rounded-[28px] border border-white/8 bg-zinc-950/80 p-5 sm:p-6">
            <div className="flex flex-col gap-4 border-b border-white/8 pb-6 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10 text-cyan-200">
                  <MiniIcon />
                </div>
                <p className="mt-4 text-[11px] uppercase tracking-[0.24em] text-cyan-300">
                  {activeSection.eyebrow}
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
                  {activeSection.title}
                </h3>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-400">
                  {activeSection.summary}
                </p>
              </div>
            </div>

            <div className="grid gap-5 pt-6 xl:grid-cols-3">
              <div className="rounded-3xl border border-white/8 bg-zinc-900/45 p-5 xl:col-span-3">
                <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                  Objetivo
                </p>
                <p className="mt-3 text-base leading-7 text-zinc-200">
                  {activeSection.objective}
                </p>
              </div>

              <div className="rounded-3xl border border-white/8 bg-zinc-900/45 p-5">
                <h4 className="text-lg font-semibold text-white">Que incluye</h4>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-zinc-400">
                  {activeSection.items.map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-3xl border border-white/8 bg-zinc-900/45 p-5">
                <h4 className="text-lg font-semibold text-white">Uso diario</h4>
                <ol className="mt-4 space-y-3 text-sm leading-6 text-zinc-400">
                  {activeSection.routine.map((item, index) => (
                    <li key={item} className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-500/20 bg-cyan-500/10 text-xs text-cyan-200">
                        {index + 1}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-3xl border border-white/8 bg-zinc-900/45 p-5">
                <h4 className="text-lg font-semibold text-white">Buenas practicas</h4>
                <ul className="mt-4 space-y-3 text-sm leading-6 text-zinc-400">
                  {activeSection.tips.map((item) => (
                    <li key={item} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
