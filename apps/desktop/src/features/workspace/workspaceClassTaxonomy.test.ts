import { describe, expect, it } from "vitest";
import {
  workspaceClassSetupToClassesManifest,
  derivedTaskType,
  validateClassSetup,
  slugifyClassName,
  workspaceClassSummary,
  workspaceClassSummaryFromLegacy,
  type WorkspaceClassSetup,
} from "./workspaceClassTaxonomy";

function makeSetup(overrides: Partial<WorkspaceClassSetup> = {}): WorkspaceClassSetup {
  return {
    taskType: "detect",
    mediaMode: "images",
    detectClasses: [],
    clfClasses: [],
    setupMode: "manual",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// slugifyClassName
// ---------------------------------------------------------------------------

describe("slugifyClassName", () => {
  it("converts spaces to underscores", () => {
    expect(slugifyClassName("My Class")).toBe("my_class");
  });

  it("strips special characters", () => {
    expect(slugifyClassName("person (v2)!")).toBe("person_v2");
  });

  it("lowercases input", () => {
    expect(slugifyClassName("TRUCK")).toBe("truck");
  });

  it("falls back to 'class' when slug is empty", () => {
    expect(slugifyClassName("!!!")).toBe("class");
    expect(slugifyClassName("   ")).toBe("class");
  });

  it("trims leading/trailing underscores", () => {
    expect(slugifyClassName("_person_")).toBe("person");
  });
});

// ---------------------------------------------------------------------------
// workspaceClassSetupToClassesManifest — detect-only
// ---------------------------------------------------------------------------

describe("workspaceClassSetupToClassesManifest — detect-only", () => {
  it("creates detect classDefs and classKeys in entry order", () => {
    const setup = makeSetup({
      taskType: "detect",
      detectClasses: [{ name: "person" }, { name: "car" }],
    });
    const m = workspaceClassSetupToClassesManifest(setup);
    expect(m.version).toBe(1);
    expect(m.tasks.detect.classKeys).toEqual(["person", "car"]);
    expect(m.tasks.clf.classKeys).toHaveLength(0);
    expect(m.classDefs).toHaveLength(2);
    expect(m.classDefs[0]).toEqual({ key: "person", name: "person" });
    expect(m.classDefs[1]).toEqual({ key: "car", name: "car" });
  });

  it("preserves detect class order — stable YOLO IDs", () => {
    const setup = makeSetup({
      taskType: "detect",
      detectClasses: [{ name: "truck" }, { name: "person" }, { name: "car" }],
    });
    const m = workspaceClassSetupToClassesManifest(setup);
    expect(m.tasks.detect.classKeys).toEqual(["truck", "person", "car"]);
  });

  it("falls back to object class when detect classes are empty", () => {
    const setup = makeSetup({ taskType: "detect" });
    const m = workspaceClassSetupToClassesManifest(setup);
    expect(m.classDefs[0].key).toBe("object");
    expect(m.tasks.detect.classKeys).toContain("object");
    expect(m.tasks.clf.classKeys).toHaveLength(0);
  });

  it("slugifies class names to safe keys", () => {
    const setup = makeSetup({
      taskType: "detect",
      detectClasses: [{ name: "My Class (v2)" }, { name: "2nd Object" }],
    });
    const m = workspaceClassSetupToClassesManifest(setup);
    for (const key of m.tasks.detect.classKeys) {
      expect(key).toMatch(/^[a-z0-9_-]+$/);
    }
  });

  it("deduplicates conflicting slugs", () => {
    const setup = makeSetup({
      taskType: "detect",
      detectClasses: [{ name: "My Class" }, { name: "my class" }],
    });
    const m = workspaceClassSetupToClassesManifest(setup);
    const keys = m.classDefs.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// workspaceClassSetupToClassesManifest — classify-only
// ---------------------------------------------------------------------------

describe("workspaceClassSetupToClassesManifest — classify-only", () => {
  it("creates clf classKeys and no detect keys", () => {
    const setup = makeSetup({
      taskType: "classify",
      clfClasses: [{ name: "day" }, { name: "night" }],
    });
    const m = workspaceClassSetupToClassesManifest(setup);
    expect(m.tasks.detect.classKeys).toHaveLength(0);
    expect(m.tasks.clf.classKeys).toEqual(["day", "night"]);
    expect(m.classDefs).toHaveLength(2);
  });

  it("ignores detectClasses when task is classify", () => {
    const setup = makeSetup({
      taskType: "classify",
      detectClasses: [{ name: "person" }], // should be ignored
      clfClasses: [{ name: "day" }],
    });
    const m = workspaceClassSetupToClassesManifest(setup);
    expect(m.tasks.detect.classKeys).toHaveLength(0);
    expect(m.classDefs.map((d) => d.name)).not.toContain("person");
  });

  it("produces folder-safe classification class keys", () => {
    const setup = makeSetup({
      taskType: "classify",
      clfClasses: [{ name: "Class A (v2)" }, { name: "class_b" }],
    });
    const m = workspaceClassSetupToClassesManifest(setup);
    for (const key of m.tasks.clf.classKeys) {
      expect(key).toMatch(/^[a-z0-9_-]+$/);
    }
  });

  it("falls back to object class when clf classes are empty", () => {
    const setup = makeSetup({ taskType: "classify" });
    const m = workspaceClassSetupToClassesManifest(setup);
    expect(m.tasks.clf.classKeys).toContain("object");
    expect(m.tasks.detect.classKeys).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// workspaceClassSetupToClassesManifest — both tasks
// ---------------------------------------------------------------------------

describe("workspaceClassSetupToClassesManifest — both tasks", () => {
  it("partitions detect and clf correctly", () => {
    const setup = makeSetup({
      taskType: "both",
      detectClasses: [{ name: "person" }, { name: "car" }],
      clfClasses: [{ name: "day" }, { name: "night" }],
    });
    const m = workspaceClassSetupToClassesManifest(setup);
    expect(m.tasks.detect.classKeys).toEqual(["person", "car"]);
    expect(m.tasks.clf.classKeys).toEqual(["day", "night"]);
    expect(m.classDefs).toHaveLength(4);
  });

  it("deduplicates shared class names across detect and clf", () => {
    const setup = makeSetup({
      taskType: "both",
      detectClasses: [{ name: "person" }, { name: "car" }],
      clfClasses: [{ name: "person" }, { name: "outdoor" }],
    });
    const m = workspaceClassSetupToClassesManifest(setup);
    expect(m.tasks.detect.classKeys).toContain("person");
    expect(m.tasks.clf.classKeys).toContain("person");
    // "person" should appear only once in classDefs
    expect(m.classDefs.filter((d) => d.key === "person")).toHaveLength(1);
    expect(m.classDefs).toHaveLength(3); // person, car, outdoor
  });

  it("detect classes appear before clf-only classes in classDefs", () => {
    const setup = makeSetup({
      taskType: "both",
      detectClasses: [{ name: "car" }],
      clfClasses: [{ name: "indoor" }],
    });
    const m = workspaceClassSetupToClassesManifest(setup);
    expect(m.classDefs[0].name).toBe("car");
    expect(m.classDefs[1].name).toBe("indoor");
  });
});

// ---------------------------------------------------------------------------
// derivedTaskType
// ---------------------------------------------------------------------------

describe("derivedTaskType", () => {
  it("detect-only manifest", () => {
    const m = {
      version: 1 as const,
      classDefs: [{ key: "car", name: "car" }],
      tasks: { detect: { classKeys: ["car"] }, clf: { classKeys: [] } },
    };
    expect(derivedTaskType(m)).toBe("detect");
  });

  it("classify-only manifest", () => {
    const m = {
      version: 1 as const,
      classDefs: [{ key: "day", name: "day" }],
      tasks: { detect: { classKeys: [] }, clf: { classKeys: ["day"] } },
    };
    expect(derivedTaskType(m)).toBe("classify");
  });

  it("both tasks manifest", () => {
    const m = {
      version: 1 as const,
      classDefs: [{ key: "car", name: "car" }],
      tasks: { detect: { classKeys: ["car"] }, clf: { classKeys: ["car"] } },
    };
    expect(derivedTaskType(m)).toBe("both");
  });

  it("empty manifest defaults to detect", () => {
    const m = {
      version: 1 as const,
      classDefs: [],
      tasks: { detect: { classKeys: [] }, clf: { classKeys: [] } },
    };
    expect(derivedTaskType(m)).toBe("detect");
  });
});

// ---------------------------------------------------------------------------
// validateClassSetup
// ---------------------------------------------------------------------------

describe("validateClassSetup", () => {
  it("detect-only with no detect classes is valid (uses default)", () => {
    expect(validateClassSetup(makeSetup({ taskType: "detect" }))).toHaveLength(0);
  });

  it("valid detect classes", () => {
    const setup = makeSetup({
      taskType: "detect",
      detectClasses: [{ name: "person" }, { name: "car" }],
    });
    expect(validateClassSetup(setup)).toHaveLength(0);
  });

  it("rejects blank detect class names", () => {
    const setup = makeSetup({
      taskType: "detect",
      detectClasses: [{ name: "person" }, { name: "" }],
    });
    const errors = validateClassSetup(setup);
    expect(errors.some((e) => e.toLowerCase().includes("empty"))).toBe(true);
  });

  it("rejects duplicate detect class names", () => {
    const setup = makeSetup({
      taskType: "detect",
      detectClasses: [{ name: "person" }, { name: "person" }],
    });
    const errors = validateClassSetup(setup);
    expect(errors.some((e) => e.toLowerCase().includes("duplicate"))).toBe(true);
  });

  it("classify-only does not validate detect class entries", () => {
    const setup = makeSetup({
      taskType: "classify",
      detectClasses: [{ name: "" }], // would fail detect validation but ignored
      clfClasses: [{ name: "day" }],
    });
    expect(validateClassSetup(setup)).toHaveLength(0);
  });

  it("rejects duplicate clf class names", () => {
    const setup = makeSetup({
      taskType: "classify",
      clfClasses: [{ name: "day" }, { name: "day" }],
    });
    const errors = validateClassSetup(setup);
    expect(errors.some((e) => e.toLowerCase().includes("duplicate"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// workspaceClassSummary
// ---------------------------------------------------------------------------

describe("workspaceClassSummary", () => {
  it("derives summary from detect-only manifest", () => {
    const m = {
      version: 1 as const,
      classDefs: [{ key: "person", name: "Person" }, { key: "car", name: "Car" }],
      tasks: { detect: { classKeys: ["person", "car"] }, clf: { classKeys: [] } },
    };
    const s = workspaceClassSummary(m);
    expect(s.taskType).toBe("detect");
    expect(s.detectClassCount).toBe(2);
    expect(s.detectClassNames).toEqual(["Person", "Car"]);
    expect(s.clfClassCount).toBe(0);
  });

  it("derives summary from both-task manifest", () => {
    const m = {
      version: 1 as const,
      classDefs: [{ key: "car", name: "Car" }, { key: "day", name: "Day" }],
      tasks: { detect: { classKeys: ["car"] }, clf: { classKeys: ["day"] } },
    };
    const s = workspaceClassSummary(m);
    expect(s.taskType).toBe("both");
    expect(s.detectClassNames).toEqual(["Car"]);
    expect(s.clfClassNames).toEqual(["Day"]);
  });
});

// ---------------------------------------------------------------------------
// workspaceClassSummaryFromLegacy
// ---------------------------------------------------------------------------

describe("workspaceClassSummaryFromLegacy", () => {
  it("adapts legacy numeric classes as detect-only, sorted by id", () => {
    const legacy = [{ id: 1, name: "Car" }, { id: 0, name: "Person" }];
    const s = workspaceClassSummaryFromLegacy(legacy);
    expect(s.taskType).toBe("detect");
    expect(s.detectClassNames).toEqual(["Person", "Car"]); // sorted by id
    expect(s.detectClassCount).toBe(2);
    expect(s.clfClassCount).toBe(0);
    expect(s.clfClassNames).toHaveLength(0);
  });

  it("returns empty summary for no legacy classes", () => {
    const s = workspaceClassSummaryFromLegacy([]);
    expect(s.detectClassCount).toBe(0);
    expect(s.taskType).toBe("detect");
  });
});
