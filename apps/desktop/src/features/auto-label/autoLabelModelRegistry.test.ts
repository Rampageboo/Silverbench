import { describe, expect, it } from "vitest";
import {
  classifyModelDestPath,
  detectModelDestPath,
  modelDestPath,
  modelFilename,
  parseModelRegistry,
  updateRegistry,
  validatePtExtension,
  activeModelFilename,
  type AutoLabelModelRegistry,
} from "./autoLabelModelRegistry";

describe("autoLabelModelRegistry", () => {
  describe("detectModelDestPath", () => {
    it("resolves to models/autolabel/detect/", () => {
      expect(detectModelDestPath("my_model.pt")).toBe("models/autolabel/detect/my_model.pt");
    });
  });

  describe("classifyModelDestPath", () => {
    it("resolves to models/autolabel/classify/", () => {
      expect(classifyModelDestPath("clf_v2.pt")).toBe("models/autolabel/classify/clf_v2.pt");
    });
  });

  describe("modelDestPath", () => {
    it("routes detect kind to detect folder", () => {
      expect(modelDestPath("detect", "foo.pt")).toBe("models/autolabel/detect/foo.pt");
    });

    it("routes classify kind to classify folder", () => {
      expect(modelDestPath("classify", "bar.pt")).toBe("models/autolabel/classify/bar.pt");
    });
  });

  describe("modelFilename", () => {
    it("extracts filename from unix path", () => {
      expect(modelFilename("/home/user/models/yolo.pt")).toBe("yolo.pt");
    });

    it("extracts filename from windows path", () => {
      expect(modelFilename("C:\\Users\\user\\models\\best.pt")).toBe("best.pt");
    });

    it("returns the value unchanged when no separator", () => {
      expect(modelFilename("standalone.pt")).toBe("standalone.pt");
    });
  });

  describe("validatePtExtension", () => {
    it("accepts .pt files", () => {
      expect(validatePtExtension("model.pt")).toBe(true);
    });

    it("accepts .PT files (case-insensitive)", () => {
      expect(validatePtExtension("model.PT")).toBe(true);
    });

    it("rejects .onnx files", () => {
      expect(validatePtExtension("model.onnx")).toBe(false);
    });

    it("rejects .bin files", () => {
      expect(validatePtExtension("model.bin")).toBe(false);
    });

    it("rejects files with no extension", () => {
      expect(validatePtExtension("model")).toBe(false);
    });
  });

  describe("parseModelRegistry", () => {
    it("returns empty object for invalid JSON", () => {
      expect(parseModelRegistry("not json")).toEqual({});
    });

    it("returns empty object for empty string", () => {
      expect(parseModelRegistry("")).toEqual({});
    });

    it("parses a valid registry", () => {
      const json = JSON.stringify({
        detect: { activeModel: "models/autolabel/detect/yolo.pt", updatedAt: "2026-01-01T00:00:00.000Z" },
      });
      const result = parseModelRegistry(json);
      expect(result.detect?.activeModel).toBe("models/autolabel/detect/yolo.pt");
    });
  });

  describe("updateRegistry", () => {
    it("adds detect entry to empty registry", () => {
      const result = updateRegistry({}, "detect", "models/autolabel/detect/yolo.pt", "2026-01-01T00:00:00.000Z");
      expect(result.detect?.activeModel).toBe("models/autolabel/detect/yolo.pt");
      expect(result.classify).toBeUndefined();
    });

    it("adds classify entry to empty registry", () => {
      const result = updateRegistry({}, "classify", "models/autolabel/classify/clf.pt", "2026-01-01T00:00:00.000Z");
      expect(result.classify?.activeModel).toBe("models/autolabel/classify/clf.pt");
      expect(result.detect).toBeUndefined();
    });

    it("preserves detect entry when updating classify", () => {
      const existing: AutoLabelModelRegistry = {
        detect: { activeModel: "models/autolabel/detect/yolo.pt", updatedAt: "2026-01-01T00:00:00.000Z" },
      };
      const result = updateRegistry(existing, "classify", "models/autolabel/classify/clf.pt", "2026-01-02T00:00:00.000Z");
      expect(result.detect?.activeModel).toBe("models/autolabel/detect/yolo.pt");
      expect(result.classify?.activeModel).toBe("models/autolabel/classify/clf.pt");
    });

    it("preserves classify entry when updating detect", () => {
      const existing: AutoLabelModelRegistry = {
        classify: { activeModel: "models/autolabel/classify/clf.pt", updatedAt: "2026-01-01T00:00:00.000Z" },
      };
      const result = updateRegistry(existing, "detect", "models/autolabel/detect/yolo_v2.pt", "2026-01-02T00:00:00.000Z");
      expect(result.classify?.activeModel).toBe("models/autolabel/classify/clf.pt");
      expect(result.detect?.activeModel).toBe("models/autolabel/detect/yolo_v2.pt");
    });

    it("overwrites previous model of the same kind", () => {
      const existing: AutoLabelModelRegistry = {
        detect: { activeModel: "models/autolabel/detect/yolo_v1.pt", updatedAt: "2026-01-01T00:00:00.000Z" },
      };
      const result = updateRegistry(existing, "detect", "models/autolabel/detect/yolo_v2.pt", "2026-01-02T00:00:00.000Z");
      expect(result.detect?.activeModel).toBe("models/autolabel/detect/yolo_v2.pt");
    });

    it("stores relative paths only", () => {
      const result = updateRegistry({}, "detect", "models/autolabel/detect/yolo.pt", "2026-01-01T00:00:00.000Z");
      const path = result.detect?.activeModel ?? "";
      expect(path.startsWith("models/")).toBe(true);
      expect(path).not.toContain(":\\");
      expect(path).not.toMatch(/^\/[^/]/);
    });
  });

  describe("activeModelFilename", () => {
    it("returns null for undefined entry", () => {
      expect(activeModelFilename(undefined)).toBeNull();
    });

    it("returns null for null entry", () => {
      expect(activeModelFilename(null)).toBeNull();
    });

    it("returns null for entry with empty activeModel", () => {
      expect(activeModelFilename({ activeModel: "", updatedAt: "" })).toBeNull();
    });

    it("extracts filename from relative path", () => {
      expect(activeModelFilename({ activeModel: "models/autolabel/detect/yolo.pt", updatedAt: "" })).toBe("yolo.pt");
    });
  });
});
