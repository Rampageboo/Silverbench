export type WorkspaceVersionId = `V${number}`;

export type WorkspaceVersionEntry = {
  id: WorkspaceVersionId;
  path: string;
  createdAt: string;
  source?: string;
};

export type WorkspaceVersionsManifest = {
  version: 1;
  type: "yolo-workbench-snapshot-versions";
  activeVersion: WorkspaceVersionId;
  createdAt: string;
  updatedAt: string;
  versions: WorkspaceVersionEntry[];
};

export type WorkspaceVersionCreateInput = {
  fromVersionId: WorkspaceVersionId;
  now?: string;
};

const VERSION_ID_RE = /^V([1-9]\d*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function joinWorkspacePath(root: string, relativePath: string) {
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  const trimmedRelative = relativePath.replace(/^[\\/]+/, "");
  if (/^[A-Za-z]:[\\/]/.test(relativePath) || relativePath.startsWith("\\\\") || relativePath.startsWith("/")) {
    return relativePath;
  }
  return `${trimmedRoot}/${trimmedRelative}`;
}

export function normalizeVersionId(value: unknown): WorkspaceVersionId {
  const text = String(value ?? "").trim().toUpperCase();
  const match = VERSION_ID_RE.exec(text);
  if (!match) throw new Error(`Invalid workspace version id: ${String(value)}`);
  return `V${Number(match[1])}` as WorkspaceVersionId;
}

export function validateWorkspaceVersionsManifest(value: unknown): WorkspaceVersionsManifest {
  if (!isRecord(value)) throw new Error("workspace_versions.json must be an object.");
  const rawVersions = value.versions;
  if (!Array.isArray(rawVersions) || rawVersions.length === 0) {
    throw new Error("workspace_versions.json must contain at least one version.");
  }

  const seen = new Set<WorkspaceVersionId>();
  const versions = rawVersions.map((raw, index): WorkspaceVersionEntry => {
    if (!isRecord(raw)) throw new Error(`versions[${index}] must be an object.`);
    const id = normalizeVersionId(raw.id);
    if (seen.has(id)) throw new Error(`Duplicate workspace version id: ${id}`);
    seen.add(id);
    return {
      ...raw,
      id,
      path: typeof raw.path === "string" && raw.path.trim() ? raw.path.trim() : id,
      createdAt: nonEmptyString(raw.createdAt, `versions[${index}].createdAt`),
      source: typeof raw.source === "string" && raw.source.trim() ? raw.source.trim() : undefined
    };
  });

  const activeVersion = normalizeVersionId(value.activeVersion);
  if (!seen.has(activeVersion)) {
    throw new Error(`activeVersion does not exist: ${activeVersion}`);
  }

  return {
    ...value,
    version: 1,
    type: "yolo-workbench-snapshot-versions",
    activeVersion,
    createdAt: nonEmptyString(value.createdAt, "createdAt"),
    updatedAt: nonEmptyString(value.updatedAt, "updatedAt"),
    versions
  };
}

export function isSnapshotVersionedWorkspace(value: unknown): value is WorkspaceVersionsManifest {
  try {
    validateWorkspaceVersionsManifest(value);
    return true;
  } catch {
    return false;
  }
}

export function listSnapshotVersions(manifest: WorkspaceVersionsManifest): WorkspaceVersionEntry[] {
  return validateWorkspaceVersionsManifest(manifest).versions;
}

export function getActiveSnapshotVersion(manifest: WorkspaceVersionsManifest): WorkspaceVersionEntry {
  const normalized = validateWorkspaceVersionsManifest(manifest);
  const active = normalized.versions.find((entry) => entry.id === normalized.activeVersion);
  if (!active) throw new Error(`activeVersion does not exist: ${normalized.activeVersion}`);
  return active;
}

export function resolveVersionPath(workspaceRoot: string, manifest: WorkspaceVersionsManifest, versionId: WorkspaceVersionId) {
  const normalized = validateWorkspaceVersionsManifest(manifest);
  const targetId = normalizeVersionId(versionId);
  const entry = normalized.versions.find((item) => item.id === targetId);
  if (!entry) throw new Error(`Workspace version does not exist: ${targetId}`);
  return joinWorkspacePath(workspaceRoot, entry.path || entry.id);
}

export function resolveActiveVersionPath(workspaceRoot: string, manifest: WorkspaceVersionsManifest) {
  const active = getActiveSnapshotVersion(manifest);
  return joinWorkspacePath(workspaceRoot, active.path || active.id);
}

export function nextSnapshotVersionId(manifest: WorkspaceVersionsManifest): WorkspaceVersionId {
  const normalized = validateWorkspaceVersionsManifest(manifest);
  let maxVersion = 0;
  for (const entry of normalized.versions) {
    const match = VERSION_ID_RE.exec(entry.id);
    if (match) maxVersion = Math.max(maxVersion, Number(match[1]));
  }
  return `V${maxVersion + 1}` as WorkspaceVersionId;
}

export function createInitialVersionsManifest(now = new Date().toISOString()): WorkspaceVersionsManifest {
  return validateWorkspaceVersionsManifest({
    version: 1,
    type: "yolo-workbench-snapshot-versions",
    activeVersion: "V1",
    createdAt: now,
    updatedAt: now,
    versions: [
      {
        id: "V1",
        path: "V1",
        createdAt: now,
        source: "initialized-from-root"
      }
    ]
  });
}

export function addSnapshotVersion(
  manifest: WorkspaceVersionsManifest,
  input: WorkspaceVersionCreateInput
): WorkspaceVersionsManifest {
  const normalized = validateWorkspaceVersionsManifest(manifest);
  const nextId = nextSnapshotVersionId(normalized);
  const fromVersionId = normalizeVersionId(input.fromVersionId);
  if (!normalized.versions.some((entry) => entry.id === fromVersionId)) {
    throw new Error(`Source workspace version does not exist: ${fromVersionId}`);
  }
  const now = input.now || new Date().toISOString();
  return validateWorkspaceVersionsManifest({
    ...normalized,
    updatedAt: now,
    versions: [
      ...normalized.versions,
      {
        id: nextId,
        path: nextId,
        createdAt: now,
        source: `copied-from:${fromVersionId}`
      }
    ]
  });
}

export function setActiveSnapshotVersion(
  manifest: WorkspaceVersionsManifest,
  versionId: WorkspaceVersionId,
  now = new Date().toISOString()
): WorkspaceVersionsManifest {
  const normalized = validateWorkspaceVersionsManifest(manifest);
  const activeVersion = normalizeVersionId(versionId);
  if (!normalized.versions.some((entry) => entry.id === activeVersion)) {
    throw new Error(`Workspace version does not exist: ${activeVersion}`);
  }
  return validateWorkspaceVersionsManifest({
    ...normalized,
    activeVersion,
    updatedAt: now
  });
}
