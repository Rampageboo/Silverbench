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
    it("produces a .json file under the overlays root", () => {
      const path = blackoutManifestRelativePath("vid-test-abc123");
      expect(path).toMatch(/\.json$/);
      expect(path).toMatch(/workspace\/overlays\/blackouts\//);
    });

    it("sanitizes the source key so the filename portion has no special chars", () => {
      const path = blackoutManifestRelativePath("vid/bad:key?here");
      // Path will have slashes from the root prefix; only check the filename segment
      const filename = path.split("/").pop()!;
      expect(filename).not.toContain(":");
      expect(filename).not.toContain("?");
      expect(filename).not.toContain("/");
    });
  });

  describe("videoBlackoutSourceKey", () => {
    it("starts with vid- prefix", () => {
      expect(videoBlackoutSourceKey("/videos/foo.mp4")).toMatch(/^vid-/);
    });

    it("produces the same key for the same path", () => {
      const k1 = videoBlackoutSourceKey("/videos/foo.mp4");
      const k2 = videoBlackoutSourceKey("/videos/foo.mp4");
      expect(k1).toBe(k2);
    });

    it("produces different keys for different paths", () => {
      const k1 = videoBlackoutSourceKey("/videos/foo.mp4");
      const k2 = videoBlackoutSourceKey("/videos/bar.mp4");
      expect(k1).not.toBe(k2);
    });
  });

  describe("imageBlackoutSourceKey", () => {
    it("starts with img- prefix", () => {
      expect(imageBlackoutSourceKey("/images/photo.jpg")).toMatch(/^img-/);
    });

    it("produces stable keys", () => {
      expect(imageBlackoutSourceKey("/images/photo.jpg")).toBe(
        imageBlackoutSourceKey("/images/photo.jpg")
      );
    });
  });
});
