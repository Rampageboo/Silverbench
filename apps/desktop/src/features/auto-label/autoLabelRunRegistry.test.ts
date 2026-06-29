import { describe, expect, it, vi } from "vitest";
import { readTextFile, writeTextFile } from "../../api";
import {
  AUTO_LABEL_RUNS_REL_PATH,
  readAutoLabelRunKeys,
  writeAutoLabelRunKeys,
} from "./autoLabelRunRegistry";

vi.mock("../../api", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

describe("autoLabelRunRegistry", () => {
  it("returns an empty set when the registry is missing", async () => {
    vi.mocked(readTextFile).mockRejectedValueOnce(new Error("missing"));

    await expect(readAutoLabelRunKeys("D:/Workspace")).resolves.toEqual(new Set());
  });

  it("normalizes duplicate and empty keys", async () => {
    vi.mocked(readTextFile).mockResolvedValueOnce(JSON.stringify({
      version: 1,
      keys: ["classify:model:media/a.png", "", "classify:model:media/a.png", "detect:model:media/a.png"],
    }));

    await expect(readAutoLabelRunKeys("D:/Workspace")).resolves.toEqual(new Set([
      "classify:model:media/a.png",
      "detect:model:media/a.png",
    ]));
  });

  it("writes sorted keys to the workspace registry path", async () => {
    vi.mocked(writeTextFile).mockResolvedValueOnce(true);

    await writeAutoLabelRunKeys("D:/Workspace", new Set(["z", "a"]));

    expect(writeTextFile).toHaveBeenCalledWith(
      "D:/Workspace",
      AUTO_LABEL_RUNS_REL_PATH,
      `${JSON.stringify({ version: 1, keys: ["a", "z"] }, null, 2)}\n`
    );
  });
});

