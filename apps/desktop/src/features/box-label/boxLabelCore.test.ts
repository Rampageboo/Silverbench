import { describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import {
  detectLabelPathForMediaFilename,
  loadEntryLabels,
  mediaBoxLabelEntry
} from "./boxLabelCore";

vi.mock("../../api", () => ({
  readTextFile: vi.fn()
}));

describe("media box label entries", () => {
  it("maps media filenames to workspace media images and detect label files", () => {
    expect(mediaBoxLabelEntry("media", "sample.image.png")).toEqual({
      imagePath: "media/sample.image.png",
      labelPath: "detect_labels/sample.image.txt",
      basename: "sample.image.png"
    });
  });

  it("normalizes media dir slashes", () => {
    expect(mediaBoxLabelEntry("/custom_media/", "a.jpg").imagePath).toBe("custom_media/a.jpg");
  });

  it("builds detect label paths from basenames", () => {
    expect(detectLabelPathForMediaFilename("nested/a.webp")).toBe("detect_labels/a.txt");
  });

  it("returns empty labels when a media image has no label file yet", async () => {
    vi.mocked(api.readTextFile).mockRejectedValueOnce(new Error("missing"));

    await expect(
      loadEntryLabels("D:/Workspace", mediaBoxLabelEntry("media", "new.png"))
    ).resolves.toEqual([]);
  });
});
