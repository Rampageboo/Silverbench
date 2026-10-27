export type AppTheme = "graphite" | "paper";

const STORAGE_KEY = "yoloworkbench.theme";

export const APP_THEME_OPTIONS: Array<{ value: AppTheme; title: string }> = [
  { value: "graphite", title: "Graphite" },
  { value: "paper", title: "Paper" }
];

/** Older builds stored "dark" / "obsidian"; both map to graphite. */
export function normalizeAppTheme(value: unknown): AppTheme {
  return value === "paper" ? "paper" : "graphite";
}

export function readAppTheme(): AppTheme {
  try {
    return normalizeAppTheme(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "graphite";
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
