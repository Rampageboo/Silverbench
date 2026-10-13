import { describe, expect, it, vi, beforeEach } from "vitest";
import { readTextFile } from "../../api";
import { resolveActiveSnapshotWorkspacePath } from "../workspace-versioning/workspaceSnapshotVersionApi";
import { resolveActiveWorkspaceRoot } from "./activeWorkspaceRoot";

vi.mock("../../api", () => ({
  readTextFile: vi.fn(),
}));

vi.mock("../workspace-versioning/workspaceSnapshotVersionApi", () => ({
  resolveActiveSnapshotWorkspacePath: vi.fn(),
}));

function snapshotManifest(activeVersion = "V1") {
  return JSON.stringify({
    version: 1,
    type: "yolo-workbench-snapshot-versions",
    activeVersion,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    versions: [
      {
        id: "V1",
        path: "V1",
        createdAt: "2026-01-01T00:00:00.000Z",
        source: "test",
      },
    ],
  });
}

describe("resolveActiveWorkspaceRoot", () => {
  beforeEach(() => {
    vi.mocked(readTextFile).mockReset();
    vi.mocked(resolveActiveSnapshotWorkspacePath).mockReset();
  });

  it("resolves a snapshot container to its active version path from workspace_versions.json", async () => {
    vi.mocked(readTextFile).mockResolvedValueOnce(snapshotManifest());

    await expect(resolveActiveWorkspaceRoot("D:\\Yolo\\ZZZ")).resolves.toBe("D:\\Yolo\\ZZZ\\V1");

    expect(readTextFile).toHaveBeenCalledWith("D:\\Yolo\\ZZZ", "workspace_versions.json");
    expect(resolveActiveSnapshotWorkspacePath).not.toHaveBeenCalled();
  });

  it("resolves an already-open version path through the parent manifest", async () => {
    vi.mocked(readTextFile).mockResolvedValueOnce(snapshotManifest());

    await expect(resolveActiveWorkspaceRoot("D:\\Yolo\\ZZZ\\V1")).resolves.toBe("D:\\Yolo\\ZZZ\\V1");

    // Parent first, and only one read: no failing probe inside the version folder.
    expect(readTextFile).toHaveBeenCalledTimes(1);
    expect(readTextFile).toHaveBeenCalledWith("D:\\Yolo\\ZZZ", "workspace_versions.json");
    expect(resolveActiveSnapshotWorkspacePath).not.toHaveBeenCalled();
  });

  it("falls back to the backend resolver when no local snapshot manifest is readable", async () => {
    vi.mocked(readTextFile).mockRejectedValue(new Error("missing"));
    vi.mocked(resolveActiveSnapshotWorkspacePath).mockResolvedValueOnce("D:\\Other\\Active");

    await expect(resolveActiveWorkspaceRoot("D:\\Other")).resolves.toBe("D:\\Other\\Active");
  });
});
