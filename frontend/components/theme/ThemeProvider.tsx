"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type BetterPTheme = "light" | "dark";

const THEME_STORAGE_KEY = "betterp-theme-preference";
const MEXICO_CITY_TIME_ZONE = "America/Mexico_City";

type ThemeContextValue = {
  theme: BetterPTheme;
  preference: BetterPTheme | null;
  toggleTheme: () => void;
  setThemePreference: (theme: BetterPTheme | null) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getMexicoCityHour(date = new Date()) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    timeZone: MEXICO_CITY_TIME_ZONE,
  }).format(date);
  const normalized = formatted === "24" ? "0" : formatted;
  return Number.parseInt(normalized, 10);
}

export function getAutomaticTheme(date = new Date()): BetterPTheme {
  const hour = getMexicoCityHour(date);
  return hour >= 19 || hour < 6 ? "dark" : "light";
}

function getStoredPreference(): BetterPTheme | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : null;
}

function applyTheme(theme: BetterPTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<BetterPTheme | null>(null);
  const [theme, setTheme] = useState<BetterPTheme>("light");

  const syncFromPreference = useCallback((nextPreference: BetterPTheme | null) => {
    const nextTheme = nextPreference ?? getAutomaticTheme();
    setPreference(nextPreference);
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }, []);

  useEffect(() => {
    syncFromPreference(getStoredPreference());
  }, [syncFromPreference]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) {
        syncFromPreference(getStoredPreference());
      }
    };

    window.addEventListener("storage", syncStorage);
    return () => window.removeEventListener("storage", syncStorage);
  }, [syncFromPreference]);

  useEffect(() => {
    if (preference) return;
    const timer = window.setInterval(() => {
      const nextTheme = getAutomaticTheme();
      setTheme((current) => {
        if (current === nextTheme) return current;
        applyTheme(nextTheme);
        return nextTheme;
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [preference]);

  const setThemePreference = useCallback((nextPreference: BetterPTheme | null) => {
    if (typeof window !== "undefined") {
      if (nextPreference) {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
      } else {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      }
    }
    syncFromPreference(nextPreference);
  }, [syncFromPreference]);

  const toggleTheme = useCallback(() => {
    const nextTheme: BetterPTheme = theme === "dark" ? "light" : "dark";
    const automaticTheme = getAutomaticTheme();
    setThemePreference(nextTheme === automaticTheme ? null : nextTheme);
  }, [setThemePreference, theme]);

  const value = useMemo(
    () => ({
      theme,
      preference,
      toggleTheme,
      setThemePreference,
    }),
    [preference, setThemePreference, theme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useBetterPTheme() {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useBetterPTheme must be used inside ThemeProvider");
  }
  return value;
}
