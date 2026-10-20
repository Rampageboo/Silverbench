import { describe, expect, it } from "vitest";
import {
  blackoutManifestRelativePath,
  imageBlackoutSourceKey,
  normalizeOverlaysRoot,
  videoBlackoutSourceKey
} from "./blackoutOverlayApi";

describe("blackoutOverlayApi", () => {
  describe("normalizeOverlaysRoot", () => {
    it("accepts a valid relative path", () => {
      expect(normalizeOverlaysRoot("workspace/overlays/blackouts")).toBe(
        "workspace/overlays/blackouts"
      );
    });

    it("rejects absolute paths", () => {
      expect(() => normalizeOverlaysRoot("/absolute/path")).toThrow("workspace-relative");
    });

    it("rejects Windows drive paths", () => {
      expect(() => normalizeOverlaysRoot("C:/path")).toThrow("workspace-relative");
    });

    it("rejects path traversal with ..", () => {
      expect(() => normalizeOverlaysRoot("workspace/../etc")).toThrow("inside the workspace");
    });

    it("normalises backslashes to forward slashes", () => {
      expect(normalizeOverlaysRoot("workspace\\overlays")).toBe("workspace/overlays");
    });
  });

  describe("blackoutManifestRelativePath", () => {
    it("names the file after the media file under labels/overlays", () => {
      expect(blackoutManifestRelativePath("clip.mp4")).toBe("labels/overlays/clip.mp4.json");
    });

    it("keeps only the file name of a path key", () => {
      expect(blackoutManifestRelativePath("media/sub/photo.jpg")).toBe("labels/overlays/photo.jpg.json");
    });
  });

  describe("source keys", () => {
    it("are the media file name, the same for relative and absolute paths", () => {
      expect(videoBlackoutSourceKey("D:\\ws\\media\\foo.mp4")).toBe("foo.mp4");
      expect(videoBlackoutSourceKey("media/foo.mp4")).toBe("foo.mp4");
      expect(imageBlackoutSourceKey("/images/photo.jpg")).toBe("photo.jpg");
    });
  });
});
