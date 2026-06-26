import { describe, expect, it } from "vitest";
import {
  classesManifestFromLegacyClasses,
  classIdToKey,
  classKeyToClfFolder,
  classKeyToDetectId,
  createDefaultClassesManifest,
  normalizeClassesManifest
} from "./classDomain";

const defs = [
  { key: "car", name: "Car" },
  { key: "person", name: "Person" },
  { key: "truck", name: "Truck" }
];

describe("classIdToKey", () => {
  it("maps numeric id to stable key", () => {
    expect(classIdToKey(0, defs)).toBe("car");
    expect(classIdToKey(1, defs)).toBe("person");
    expect(classIdToKey(2, defs)).toBe("truck");
  });

  it("falls back to class_N for out-of-range id", () => {
    expect(classIdToKey(99, defs)).toBe("class_99");
  });
});

describe("classKeyToDetectId", () => {
  const keys = ["car", "person", "truck"];

  it("returns YOLO id by position in detectClassKeys", () => {
    expect(classKeyToDetectId("car", keys)).toBe(0);
    expect(classKeyToDetectId("truck", keys)).toBe(2);
  });

  it("returns 0 for unknown key", () => {
    expect(classKeyToDetectId("unknown", keys)).toBe(0);
  });
});

describe("classKeyToClfFolder", () => {
  it("uses class name for folder", () => {
    expect(classKeyToClfFolder("car", defs)).toBe("Car");
    expect(classKeyToClfFolder("person", defs)).toBe("Person");
  });

  it("sanitizes special characters in class name", () => {
    const special = [{ key: "x", name: "My Class! (v2)" }];
    const result = classKeyToClfFolder("x", special);
    expect(result).not.toMatch(/[!() ]/); // no special chars
    expect(result).toMatch(/My/);
    expect(result).toMatch(/Class/);
    expect(result).toMatch(/v2/);
  });

  it("falls back to key when def not found", () => {
    expect(classKeyToClfFolder("ghost", defs)).toBe("ghost");
  });
});

describe("classesManifestFromLegacyClasses", () => {
  it("converts numeric classes to keyed manifest", () => {
    const legacy = [
      { id: 0, name: "Car" },
      { id: 1, name: "Person" }
    ];
    const manifest = classesManifestFromLegacyClasses(legacy);
    expect(manifest.version).toBe(1);
    expect(manifest.classDefs).toHaveLength(2);
    expect(manifest.classDefs[0].key).toBe("car");
    expect(manifest.tasks.detect.classKeys).toEqual(["car", "person"]);
    expect(manifest.tasks.clf.classKeys).toEqual([]);
  });

  it("sorts by numeric id before converting", () => {
    const legacy = [
      { id: 2, name: "Truck" },
      { id: 0, name: "Car" },
      { id: 1, name: "Person" }
    ];
    const manifest = classesManifestFromLegacyClasses(legacy);
    expect(manifest.tasks.detect.classKeys).toEqual(["car", "person", "truck"]);
  });
});

describe("normalizeClassesManifest", () => {
  it("returns default for invalid input", () => {
    expect(normalizeClassesManifest(null).classDefs[0].key).toBe("object");
    expect(normalizeClassesManifest("bad").classDefs[0].key).toBe("object");
  });

  it("round-trips a valid manifest", () => {
    const input = {
      version: 1,
      classDefs: [{ key: "car", name: "Car" }],
      tasks: { detect: { classKeys: ["car"] }, clf: { classKeys: [] } }
    };
    const result = normalizeClassesManifest(input);
    expect(result.classDefs[0].key).toBe("car");
    expect(result.tasks.detect.classKeys).toEqual(["car"]);
  });
});

describe("createDefaultClassesManifest", () => {
  it("has object class", () => {
    const m = createDefaultClassesManifest();
    expect(m.classDefs[0].key).toBe("object");
    expect(m.tasks.detect.classKeys).toContain("object");
    expect(m.tasks.clf.classKeys).toHaveLength(0);
  });
});
