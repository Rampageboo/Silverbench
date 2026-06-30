export type AppTheme = "dark" | "obsidian";

const STORAGE_KEY = "yoloworkbench.theme";

export const APP_THEME_OPTIONS: Array<{ value: AppTheme; title: string; desc: string }> = [
  { value: "dark", title: "Dark", desc: "Current blue glass theme." },
  { value: "obsidian", title: "Obsidian", desc: "Graphite surfaces with teal and amber accents." }
];

export function normalizeAppTheme(value: unknown): AppTheme {
  return value === "obsidian" ? "obsidian" : "dark";
}

export function readAppTheme(): AppTheme {
  try {
    return normalizeAppTheme(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "dark";
  }
}

export function applyAppTheme(theme: AppTheme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function writeAppTheme(theme: AppTheme) {
  const next = normalizeAppTheme(theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Theme selection is non-critical; the DOM attribute still updates.
  }
  applyAppTheme(next);
}
