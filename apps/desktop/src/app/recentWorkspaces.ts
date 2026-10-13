const RECENT_KEY = "ywb.recentWorkspaces";
const MAX_RECENT = 8;

export function loadRecentWorkspaces(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && Boolean(item))
      : [];
  } catch {
    return [];
  }
}

function save(list: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // Recent list is a convenience; ignore storage failures.
  }
}

function samePath(a: string, b: string) {
  return normalizePath(a) === normalizePath(b);
}

function normalizePath(path: string) {
  return path
    .replace(/[/\\]+$/, "")
    .replace(/\//g, "\\")
    .toLowerCase();
}

export function pushRecentWorkspace(path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed) return loadRecentWorkspaces();
  const list = [trimmed, ...loadRecentWorkspaces().filter((item) => !samePath(item, trimmed))];
  save(list);
  return list.slice(0, MAX_RECENT);
}

export function removeRecentWorkspace(path: string): string[] {
  const list = loadRecentWorkspaces().filter((item) => !samePath(item, path));
  save(list);
  return list;
}

export function workspaceDisplayName(path: string) {
  return (
    path
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .at(-1) || path
  );
}
