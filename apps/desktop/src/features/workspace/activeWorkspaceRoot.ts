import { readTextFile } from "../../api";
import { resolveActiveSnapshotWorkspacePath } from "../workspace-versioning/workspaceSnapshotVersionApi";
import { validateWorkspaceVersionsManifest, type WorkspaceVersionsManifest } from "../workspace-versioning/workspaceSnapshotVersions";

const SNAPSHOT_VERSIONS_PATH = "workspace_versions.json";
const VERSION_DIR_RE = /^V[1-9][0-9]*$/i;

export function normalizeWorkspacePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function sameWorkspacePath(a: string, b: string): boolean {
  return normalizeWorkspacePath(a) === normalizeWorkspacePath(b);
}

function pathSeparator(path: string): "\\" | "/" {
  return path.includes("\\") ? "\\" : "/";
}

function trimTrailingSeparators(path: string): string {
  return path.trim().replace(/[\\/]+$/, "");
}

function pathBasename(path: string): string {
  const normalized = trimTrailingSeparators(path);
  const index = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function pathDirname(path: string): string {
  const normalized = trimTrailingSeparators(path);
  const index = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return index > 0 ? normalized.slice(0, index) : "";
}

function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("//") || path.startsWith("/");
}

function joinPath(root: string, child: string): string {
  if (isAbsolutePath(child)) return child;
  const separator = pathSeparator(root);
  return `${trimTrailingSeparators(root)}${separator}${child.replace(/[\\/]+/g, separator)}`;
}

async function readSnapshotManifest(workspaceRoot: string): Promise<WorkspaceVersionsManifest | null> {
  try {
    const text = await readTextFile(workspaceRoot, SNAPSHOT_VERSIONS_PATH);
    return validateWorkspaceVersionsManifest(JSON.parse(text));
  } catch {
    return null;
  }
}

function activePathFromManifest(containerRoot: string, manifest: WorkspaceVersionsManifest): string {
  const active = manifest.activeVersion;
  const entry = manifest.versions.find((item) => item.id === active);
  return joinPath(containerRoot, entry?.path || active);
}

async function resolveActiveWorkspaceRootFromManifest(workspaceRoot: string): Promise<string | null> {
  const root = trimTrailingSeparators(workspaceRoot);
  // An open version folder (…/V1) never holds the manifest itself; ask its parent
  // first so the common case does not issue a failing read on every call.
  const parent = VERSION_DIR_RE.test(pathBasename(root)) ? pathDirname(root) : "";
  if (parent) {
    const parentManifest = await readSnapshotManifest(parent);
    if (parentManifest) return activePathFromManifest(parent, parentManifest);
  }
  const manifest = await readSnapshotManifest(root);
  return manifest ? activePathFromManifest(root, manifest) : null;
}

export async function resolveActiveWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const root = workspaceRoot.trim();
  if (!root) return "";
  const manifestRoot = await resolveActiveWorkspaceRootFromManifest(root);
  if (manifestRoot) return manifestRoot;
  try {
    const resolved = (await resolveActiveSnapshotWorkspacePath(root)).trim();
    return resolved || root;
  } catch {
    return root;
  }
}

export function dispatchWorkspaceClassesChangedForRoots(
  dispatch: (workspaceRoot: string) => void,
  workspaceRoot: string,
  activeWorkspaceRoot: string
): void {
  const root = workspaceRoot.trim();
  const activeRoot = activeWorkspaceRoot.trim();
  if (root) dispatch(root);
  if (activeRoot && !sameWorkspacePath(activeRoot, root)) dispatch(activeRoot);
}
