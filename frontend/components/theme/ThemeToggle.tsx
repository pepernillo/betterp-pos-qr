"use client";

import { useBetterPTheme } from "./ThemeProvider";

function SunIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      className={className}
    >
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.4 4.4l1.7 1.7M17.9 17.9l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.4 19.6l1.7-1.7M17.9 6.1l1.7-1.7" />
    </svg>
  );
}

function MoonIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      className={className}
    >
      <path d="M20.4 14.6A7.8 7.8 0 0 1 9.4 3.6 8.5 8.5 0 1 0 20.4 14.6Z" />
    </svg>
  );
}

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, preference, toggleTheme } = useBetterPTheme();
  const isDark = theme === "dark";
  const title = isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro";

  return (
    <button
      type="button"
      aria-label={title}
      aria-pressed={isDark}
      title={preference ? title : `${title} (automatico CDMX)`}
      onClick={toggleTheme}
      className={`theme-toggle relative inline-flex h-10 w-[68px] shrink-0 items-center rounded-full border p-1 transition ${className}`.trim()}
    >
      <span className="theme-toggle-icon theme-toggle-sun pointer-events-none absolute left-3 flex h-4 w-4 items-center justify-center">
        <SunIcon className="h-4 w-4" />
      </span>
      <span className="theme-toggle-icon theme-toggle-moon pointer-events-none absolute right-3 flex h-4 w-4 items-center justify-center">
        <MoonIcon className="h-4 w-4" />
      </span>
      <span
        className={`theme-toggle-thumb flex h-8 w-8 items-center justify-center rounded-full transition-transform ${
          isDark ? "translate-x-7" : "translate-x-0"
        }`}
      />
    </button>
  );
}
