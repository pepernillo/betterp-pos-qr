export type BackofficeSectionKey =
  | "dashboard"
  | "soluciones"
  | "salud"
  | "clientes"
  | "ventas"
  | "planes"
  | "admins"
  | "marketing"
  | "solicitudes"
  | "configuracion";

export const BACKOFFICE_SECTION_LABELS: Record<BackofficeSectionKey, string> = {
  dashboard: "Dashboard",
  soluciones: "Soluciones",
  salud: "Salud operativa",
  clientes: "Clientes SaaS",
  ventas: "Ventas BetterP",
  planes: "Planes",
  admins: "Admins de plataforma",
  marketing: "Publicidad y mkt",
  solicitudes: "Solicitudes",
  configuracion: "Configuracion interna",
};

export function getBackofficeHref(section: BackofficeSectionKey) {
  return section === "dashboard" ? "/backoffice" : `/backoffice/${section}`;
}

export function getBackofficeSectionFromPath(pathname: string): BackofficeSectionKey {
  if (
    pathname === "/backoffice/soluciones" ||
    pathname === "/admin/soluciones" ||
    pathname === "/administracion-negocio/soluciones"
  ) {
    return "soluciones";
  }
  if (
    pathname === "/backoffice/salud" ||
    pathname === "/admin/salud" ||
    pathname === "/administracion-negocio/salud"
  ) {
    return "salud";
  }
  if (
    pathname === "/backoffice/clientes" ||
    pathname === "/admin/clientes" ||
    pathname === "/administracion-negocio/clientes"
  ) {
    return "clientes";
  }
  if (
    pathname === "/backoffice/ventas" ||
    pathname === "/admin/ventas" ||
    pathname === "/administracion-negocio/ventas"
  ) {
    return "ventas";
  }
  if (
    pathname === "/backoffice/planes" ||
    pathname === "/admin/planes" ||
    pathname === "/administracion-negocio/planes"
  ) {
    return "planes";
  }
  if (
    pathname === "/backoffice/admins" ||
    pathname === "/admin/admins" ||
    pathname === "/administracion-negocio/admins"
  ) {
    return "admins";
  }
  if (
    pathname === "/backoffice/marketing" ||
    pathname === "/admin/marketing" ||
    pathname === "/administracion-negocio/marketing"
  ) {
    return "marketing";
  }
  if (
    pathname === "/backoffice/solicitudes" ||
    pathname === "/admin/solicitudes" ||
    pathname === "/administracion-negocio/solicitudes"
  ) {
    return "solicitudes";
  }
  if (
    pathname === "/backoffice/configuracion" ||
    pathname === "/admin/configuracion" ||
    pathname === "/administracion-negocio/configuracion"
  ) {
    return "configuracion";
  }
  return "dashboard";
}
