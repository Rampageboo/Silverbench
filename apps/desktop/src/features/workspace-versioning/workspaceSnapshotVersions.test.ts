import { describe, expect, it } from "vitest";
import {
  addSnapshotVersion,
  createInitialVersionsManifest,
  getActiveSnapshotVersion,
  isSnapshotVersionedWorkspace,
  listSnapshotVersions,
  nextSnapshotVersionId,
  normalizeVersionId,
  resolveActiveVersionPath,
  resolveVersionPath,
  setActiveSnapshotVersion,
  validateWorkspaceVersionsManifest
} from "./workspaceSnapshotVersions";

const NOW = "2026-06-29T00:00:00.000Z";

describe("workspace snapshot versions", () => {
  it("normalizes V1 style ids and rejects v001 style ids", () => {
    expect(normalizeVersionId("v2")).toBe("V2");
    expect(() => normalizeVersionId("v001")).toThrow(/Invalid workspace version id/);
  });

  it("creates an initial manifest with active V1", () => {
    const manifest = createInitialVersionsManifest(NOW);
    expect(manifest.activeVersion).toBe("V1");
    expect(manifest.versions).toHaveLength(1);
    expect(getActiveSnapshotVersion(manifest).id).toBe("V1");
  });

  it("returns V2 after V1", () => {
    const manifest = createInitialVersionsManifest(NOW);
    expect(nextSnapshotVersionId(manifest)).toBe("V2");
  });

  it("adds a V2 entry copied from V1 without switching active version", () => {
    const manifest = addSnapshotVersion(createInitialVersionsManifest(NOW), {
      fromVersionId: "V1",
      now: "2026-06-29T00:01:00.000Z"
    });
    expect(listSnapshotVersions(manifest).map((entry) => entry.id)).toEqual(["V1", "V2"]);
    expect(manifest.activeVersion).toBe("V1");
    expect(manifest.versions[1].source).toBe("copied-from:V1");
  });

  it("switches active version to an existing entry", () => {
    const manifest = addSnapshotVersion(createInitialVersionsManifest(NOW), {
      fromVersionId: "V1",
      now: "2026-06-29T00:01:00.000Z"
    });
    expect(setActiveSnapshotVersion(manifest, "V2", "2026-06-29T00:02:00.000Z").activeVersion).toBe("V2");
  });

  it("rejects manifests whose active version is missing", () => {
    expect(() =>
      validateWorkspaceVersionsManifest({
        version: 1,
        type: "yolo-workbench-snapshot-versions",
        activeVersion: "V2",
        createdAt: NOW,
        updatedAt: NOW,
        versions: [{ id: "V1", path: "V1", createdAt: NOW }]
      })
    ).toThrow(/activeVersion does not exist/);
  });

  it("resolves active and explicit paths under the workspace root", () => {
    const manifest = addSnapshotVersion(createInitialVersionsManifest(NOW), {
      fromVersionId: "V1",
      now: "2026-06-29T00:01:00.000Z"
    });
    const switched = setActiveSnapshotVersion(manifest, "V2", "2026-06-29T00:02:00.000Z");
    expect(resolveActiveVersionPath("D:/Yolo/ZZZ", switched)).toBe("D:/Yolo/ZZZ/V2");
    expect(resolveVersionPath("D:/Yolo/ZZZ", switched, "V1")).toBe("D:/Yolo/ZZZ/V1");
  });

  it("identifies valid snapshot manifests", () => {
    expect(isSnapshotVersionedWorkspace(createInitialVersionsManifest(NOW))).toBe(true);
    expect(isSnapshotVersionedWorkspace({ activeVersion: "V1", versions: [] })).toBe(false);
  });
});
