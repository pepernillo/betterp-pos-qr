export type FiscalPersonType = "fisica" | "moral";

export interface FiscalRegimeOption {
  value: string;
  label: string;
  personas: FiscalPersonType[];
  aliases?: string[];
}

export const GENERIC_PUBLIC_RFC = "XAXX010101000";
export const GENERIC_PUBLIC_NAME = "PUBLICO EN GENERAL";
export const GENERIC_PUBLIC_REGIME = "616";
export const GENERIC_PUBLIC_CFDI_USE = "S01";

export const FISCAL_REGIME_OPTIONS: FiscalRegimeOption[] = [
  {
    value: "601",
    label: "601 - General de Ley Personas Morales",
    personas: ["moral"],
    aliases: ["Regimen General de Ley Personas Morales"],
  },
  {
    value: "603",
    label: "603 - Personas Morales con Fines no Lucrativos",
    personas: ["moral"],
    aliases: ["Regimen de las Personas Morales con Fines no Lucrativos"],
  },
  {
    value: "605",
    label: "605 - Sueldos y Salarios e Ingresos Asimilados a Salarios",
    personas: ["fisica"],
  },
  {
    value: "606",
    label: "606 - Arrendamiento",
    personas: ["fisica"],
    aliases: ["Regimen de Arrendamiento"],
  },
  {
    value: "607",
    label: "607 - Enajenacion o Adquisicion de Bienes",
    personas: ["fisica"],
    aliases: ["Regimen de Enajenacion o Adquisicion de Bienes"],
  },
  {
    value: "608",
    label: "608 - Demas ingresos",
    personas: ["fisica"],
  },
  {
    value: "610",
    label: "610 - Residentes en el Extranjero sin Establecimiento Permanente en Mexico",
    personas: ["fisica", "moral"],
  },
  {
    value: "611",
    label: "611 - Ingresos por Dividendos",
    personas: ["fisica"],
    aliases: ["Ingresos por Dividendos (socios y accionistas)"],
  },
  {
    value: "612",
    label: "612 - Personas Fisicas con Actividades Empresariales y Profesionales",
    personas: ["fisica"],
    aliases: ["Regimen de las Actividades Empresariales y Profesionales"],
  },
  {
    value: "614",
    label: "614 - Ingresos por intereses",
    personas: ["fisica"],
  },
  {
    value: "615",
    label: "615 - Ingresos por obtencion de premios",
    personas: ["fisica"],
    aliases: ["Regimen de los ingresos por obtencion de premios"],
  },
  {
    value: "616",
    label: "616 - Sin obligaciones fiscales",
    personas: ["fisica"],
  },
  {
    value: "620",
    label: "620 - Sociedades Cooperativas de Produccion que optan por diferir ingresos",
    personas: ["moral"],
  },
  {
    value: "621",
    label: "621 - Incorporacion Fiscal",
    personas: ["fisica"],
    aliases: ["Regimen de Incorporacion Fiscal"],
  },
  {
    value: "622",
    label: "622 - Actividades Agricolas, Ganaderas, Silvicolas y Pesqueras",
    personas: ["moral"],
  },
  {
    value: "623",
    label: "623 - Opcional para Grupos de Sociedades",
    personas: ["moral"],
  },
  {
    value: "624",
    label: "624 - Coordinados",
    personas: ["moral"],
  },
  {
    value: "625",
    label: "625 - Plataformas Tecnologicas",
    personas: ["fisica"],
    aliases: [
      "Regimen de las Actividades Empresariales con ingresos a traves de Plataformas Tecnologicas",
    ],
  },
  {
    value: "626",
    label: "626 - Regimen Simplificado de Confianza",
    personas: ["fisica", "moral"],
    aliases: ["Regimen Simplificado de Confianza"],
  },
];

const OPERATIONAL_FISCAL_REGIME_CODES = new Set([
  "601",
  "603",
  "606",
  "607",
  "612",
  "621",
  "625",
  "626",
]);

function normalizeFiscalText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function getFiscalRegimeOptions(isPersonaMoral: boolean) {
  const persona: FiscalPersonType = isPersonaMoral ? "moral" : "fisica";
  return FISCAL_REGIME_OPTIONS.filter((option) =>
    option.personas.includes(persona)
  );
}

export function getOperationalFiscalRegimeOptions(isPersonaMoral: boolean) {
  return getFiscalRegimeOptions(isPersonaMoral).filter((option) =>
    OPERATIONAL_FISCAL_REGIME_CODES.has(option.value)
  );
}

export function isGenericPublicRfc(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase() === GENERIC_PUBLIC_RFC;
}

function normalizeFiscalRegimeValueFromOptions(
  value: string | null | undefined,
  allowedOptions: FiscalRegimeOption[]
) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  if (allowedOptions.some((option) => option.value === rawValue)) {
    return rawValue;
  }

  const normalizedValue = normalizeFiscalText(rawValue);
  const match = allowedOptions.find((option) => {
    const possibleLabels = [option.label, ...(option.aliases || [])];
    return possibleLabels.some((label) =>
      normalizeFiscalText(label).includes(normalizedValue) ||
      normalizedValue.includes(normalizeFiscalText(label))
    );
  });

  return match?.value || "";
}

export function normalizeFiscalRegimeValue(
  value: string | null | undefined,
  isPersonaMoral: boolean
) {
  return normalizeFiscalRegimeValueFromOptions(
    value,
    getFiscalRegimeOptions(isPersonaMoral)
  );
}

export function normalizeOperationalFiscalRegimeValue(
  value: string | null | undefined,
  isPersonaMoral: boolean
) {
  return normalizeFiscalRegimeValueFromOptions(
    value,
    getOperationalFiscalRegimeOptions(isPersonaMoral)
  );
}
