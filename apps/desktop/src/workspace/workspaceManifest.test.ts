import { describe, expect, it } from "vitest";
import { normalizeWorkspaceManifest, WORKSPACE_MANIFEST_VERSION } from "./workspaceManifest";

const NOW = "2026-06-25T00:00:00.000Z";

describe("workspace manifest migration", () => {
  it("upgrades a legacy image-first manifest without losing existing fields", () => {
    const result = normalizeWorkspaceManifest(
      {
        version: 1,
        name: "legacy",
        paths: {
          image_pool: "custom-images",
          detect_labels: "detect_labels",
          metadata: "metadata.csv",
          detect_dataset: "detect_dataset",
          clf_dataset: "clf_dataset"
        },
        classification_classes: ["a", "b"]
      },
      "C:/work/legacy",
      NOW
    );

    expect(result.migrated).toBe(true);
    expect(result.manifest.version).toBe(WORKSPACE_MANIFEST_VERSION);
    expect(result.manifest.type).toBe("yolo-workbench");
    expect(result.manifest.paths.image_pool).toBe("custom-images");
    expect(result.manifest.paths.video_annotations).toBe("workspace/video_annotations");
    expect(result.manifest.tools.videoLabel).toEqual({
      enabled: true,
      primary: true,
      persistence: "timestamp-manifest",
      saveExtractedFrames: false
    });
    expect(result.manifest.tools.imageLabel).toEqual({ enabled: true, secondary: true });
    expect(result.manifest.classification_classes).toEqual(["a", "b"]);
    expect(result.manifest.createdAt).toBe(NOW);
    expect(result.manifest.updatedAt).toBe(NOW);
  });

  it("keeps a valid v2 manifest stable", () => {
    const source = {
      version: 2,
      type: "yolo-workbench",
      name: "project",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
      paths: {
        image_pool: "image_pool",
        detect_labels: "detect_labels",
        metadata: "metadata.csv",
        detect_dataset: "detect_dataset",
        clf_dataset: "clf_dataset",
        video_annotations: "workspace/custom-video-labels",
        video_segments: "video_segments",
        exports: "exports",
        cache: ".cache",
        logs: "workspace/logs",
        sources: "workspace/sources.json",
        classes: "workspace/classes.json",
        annotations: "workspace/annotations"
      },
      tools: {
        videoLabel: {
          enabled: true,
          primary: true,
          persistence: "timestamp-manifest",
          saveExtractedFrames: false
        },
        imageLabel: { enabled: true, secondary: true }
      }
    };

    const result = normalizeWorkspaceManifest(source, "/tmp/project", NOW);
    expect(result.migrated).toBe(false);
    expect(result.manifest.updatedAt).toBe(source.updatedAt);
    expect(result.manifest.paths.video_annotations).toBe("workspace/custom-video-labels");
  });

  it("repairs invalid required paths instead of trusting their types", () => {
    const result = normalizeWorkspaceManifest(
      {
        version: 2,
        type: "yolo-workbench",
        name: "broken",
        createdAt: "",
        updatedAt: "",
        paths: { image_pool: 123 },
        tools: {}
      },
      "/tmp/broken",
      NOW
    );

    expect(result.migrated).toBe(true);
    expect(result.manifest.paths.image_pool).toBe("media");
    expect(result.manifest.paths.logs).toBe("workspace/logs");
    expect(result.manifest.createdAt).toBe(NOW);
  });
});
