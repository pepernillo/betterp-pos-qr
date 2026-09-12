const themeInitScript = `
(() => {
  try {
    const storageKey = "betterp-theme-preference";
    const stored = window.localStorage.getItem(storageKey);
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      timeZone: "America/Mexico_City"
    });
    const formatted = formatter.format(new Date());
    const hour = Number.parseInt(formatted === "24" ? "0" : formatted, 10);
    const automaticTheme = hour >= 19 || hour < 6 ? "dark" : "light";
    const theme = stored === "light" || stored === "dark" ? stored : automaticTheme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
  }
})();
`;

export default function ThemeInitScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />;
}
