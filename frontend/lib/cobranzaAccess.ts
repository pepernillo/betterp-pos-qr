export const COBRANZA_INTERNAL_OWNER_EMAIL = "01.agodinez@gmail.com";
export const DEFAULT_COBRANZA_TAB = "cartera" as const;
export const INTERNAL_COBRANZA_TABS = ["preparacion", "reglas"] as const;

export function canUseCobranzaInternalTools(
  user: { email?: string | null } | null | undefined,
  isOwnerAdmin: boolean,
): boolean {
  return (
    isOwnerAdmin &&
    user?.email?.trim().toLowerCase() === COBRANZA_INTERNAL_OWNER_EMAIL
  );
}

export function isInternalCobranzaTab(
  value: string | null | undefined,
): boolean {
  return INTERNAL_COBRANZA_TABS.includes(
    value as (typeof INTERNAL_COBRANZA_TABS)[number],
  );
}
