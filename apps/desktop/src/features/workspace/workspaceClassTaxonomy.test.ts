import { describe, expect, it } from "vitest";
import {
  workspaceClassSetupToClassesManifest,
  derivedTaskType,
  validateClassSetup,
  slugifyClassName,
  workspaceClassSummary,
  workspaceClassSummaryFromLegacy,
  // Phase 4B
  addDetectClassToManifest,
  addClfClassToManifest,
  renameClassInManifest,
  archiveDetectClassInManifest,
  unarchiveDetectClassInManifest,
  archiveClfClassInManifest,
  unarchiveClfClassInManifest,
  upgradeLegacyToManifest,
  manifestToLegacyClasses,
  validateNewClassName,
  allDetectClassDefs,
  activeDetectClassDefs,
  activeDetectClasses,
  activeClassificationClasses,
  activeClfClassDefs,
  archivedClassDefs,
  archivedDetectClassIds,
  chooseClassificationManifest,
  classificationClassDisplayName,
  classificationOptionsForNewAnnotations,
  detectClassDisplayName,
  detectClassOptionsForNewAnnotations,
  exportDetectClassNamesPreservingIds,
  findClassificationClassByKey,
  findDetectClassById,
  findDetectClassByKey,
  isClassificationClassArchived,
  isDetectClassArchived,
  isDetectClassArchivedById,
  type WorkspaceClassSetup,
} from "./workspaceClassTaxonomy";
import type { ClassesManifest } from "../video/classDomain";

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

// =============================================================================
// Phase 4B — safe manifest editing
// =============================================================================

function twoClassDetectManifest(): ClassesManifest {
  return {
    version: 1,
    classDefs: [
      { key: "person", name: "Person" },
      { key: "car", name: "Car" },
    ],
    tasks: { detect: { classKeys: ["person", "car"] }, clf: { classKeys: [] } },
  };
}

function bothTaskManifest(): ClassesManifest {
  return {
    version: 1,
    classDefs: [
      { key: "person", name: "Person" },
      { key: "car", name: "Car" },
      { key: "day", name: "Day" },
      { key: "night", name: "Night" },
    ],
    tasks: {
      detect: { classKeys: ["person", "car"] },
      clf: { classKeys: ["day", "night"] },
    },
  };
}

// ---------------------------------------------------------------------------
// addDetectClassToManifest
// ---------------------------------------------------------------------------

describe("addDetectClassToManifest", () => {
  it("appends to detect classKeys — existing IDs unchanged", () => {
    const m = twoClassDetectManifest();
    const { manifest: next, classKey } = addDetectClassToManifest(m, "truck");
    expect(next.tasks.detect.classKeys).toEqual(["person", "car", "truck"]);
    expect(classKey).toBe("truck");
    // Existing IDs unchanged
    expect(next.tasks.detect.classKeys[0]).toBe("person");
    expect(next.tasks.detect.classKeys[1]).toBe("car");
  });

  it("new class gets next YOLO id", () => {
    const m = twoClassDetectManifest();
    const { manifest: next } = addDetectClassToManifest(m, "truck");
    const defs = allDetectClassDefs(next);
    expect(defs.find((d) => d.key === "truck")?.yoloId).toBe(2);
  });

  it("generates a slug key from the name", () => {
    const m = twoClassDetectManifest();
    const { classKey } = addDetectClassToManifest(m, "My Class (v2)");
    expect(classKey).toMatch(/^[a-z0-9_-]+$/);
  });

  it("deduplicates slug collision", () => {
    const m = twoClassDetectManifest();
    // "person" already exists; adding a different name that slugs to "person"
    const { manifest: next } = addDetectClassToManifest(m, "Person");
    const keys = next.classDefs.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not mutate original manifest", () => {
    const m = twoClassDetectManifest();
    addDetectClassToManifest(m, "bike");
    expect(m.tasks.detect.classKeys).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// renameClassInManifest
// ---------------------------------------------------------------------------

describe("renameClassInManifest", () => {
  it("updates name without changing key", () => {
    const m = twoClassDetectManifest();
    const next = renameClassInManifest(m, "person", "Human");
    const def = next.classDefs.find((d) => d.key === "person");
    expect(def?.name).toBe("Human");
    expect(def?.key).toBe("person"); // key unchanged
  });

  it("keeps the old name as an alias after rename", () => {
    const m = twoClassDetectManifest();
    const next = renameClassInManifest(m, "person", "Human");
    const def = next.classDefs.find((d) => d.key === "person");
    expect(def?.aliases).toEqual(["Person"]);
  });

  it("YOLO id order is preserved after rename", () => {
    const m = twoClassDetectManifest();
    const next = renameClassInManifest(m, "person", "Human");
    expect(next.tasks.detect.classKeys).toEqual(["person", "car"]);
  });

  it("classKeys list is unchanged after rename", () => {
    const m = bothTaskManifest();
    const next = renameClassInManifest(m, "day", "Daytime");
    expect(next.tasks.clf.classKeys).toEqual(["day", "night"]);
  });

  it("does not mutate original manifest", () => {
    const m = twoClassDetectManifest();
    renameClassInManifest(m, "person", "Human");
    expect(m.classDefs[0].name).toBe("Person");
  });
});

// ---------------------------------------------------------------------------
// archiveDetectClassInManifest
// ---------------------------------------------------------------------------

describe("archiveDetectClassInManifest", () => {
  it("marks classDef as archived", () => {
    const m = twoClassDetectManifest();
    const next = archiveDetectClassInManifest(m, "person");
    const def = next.classDefs.find((d) => d.key === "person");
    expect(def?.archived).toBe(true);
  });

  it("KEEPS key in tasks.detect.classKeys — ID slot reserved", () => {
    const m = twoClassDetectManifest();
    const next = archiveDetectClassInManifest(m, "person");
    expect(next.tasks.detect.classKeys).toContain("person");
    expect(next.tasks.detect.classKeys[0]).toBe("person"); // still at id 0
  });

  it("remaining class IDs are NOT shifted", () => {
    const m = twoClassDetectManifest();
    const next = archiveDetectClassInManifest(m, "person");
    expect(next.tasks.detect.classKeys[1]).toBe("car"); // car is still id 1
  });

  it("removes from clf classKeys if present", () => {
    const m: ClassesManifest = {
      ...bothTaskManifest(),
      tasks: {
        detect: { classKeys: ["person", "car"] },
        clf: { classKeys: ["person", "day"] }, // person in both
      },
    };
    const next = archiveDetectClassInManifest(m, "person");
    expect(next.tasks.clf.classKeys).not.toContain("person");
  });
});

// ---------------------------------------------------------------------------
// unarchiveDetectClassInManifest
// ---------------------------------------------------------------------------

describe("unarchiveDetectClassInManifest", () => {
  it("unsets archived flag", () => {
    const m = archiveDetectClassInManifest(twoClassDetectManifest(), "person");
    const restored = unarchiveDetectClassInManifest(m, "person");
    const def = restored.classDefs.find((d) => d.key === "person");
    expect(def?.archived).toBeFalsy();
  });

  it("YOLO id is still preserved after restore", () => {
    const m = archiveDetectClassInManifest(twoClassDetectManifest(), "person");
    const restored = unarchiveDetectClassInManifest(m, "person");
    expect(restored.tasks.detect.classKeys[0]).toBe("person");
  });
});

// ---------------------------------------------------------------------------
// addClfClassToManifest
// ---------------------------------------------------------------------------

describe("addClfClassToManifest", () => {
  it("appends to clf classKeys", () => {
    const m = bothTaskManifest();
    const { manifest: next, classKey } = addClfClassToManifest(m, "indoor");
    expect(next.tasks.clf.classKeys).toContain("indoor");
    expect(classKey).toBe("indoor");
  });

  it("does not affect detect classKeys", () => {
    const m = bothTaskManifest();
    const { manifest: next } = addClfClassToManifest(m, "indoor");
    expect(next.tasks.detect.classKeys).toEqual(["person", "car"]);
  });

  it("reuses an existing active detect class when adding the same clf class name", () => {
    const m = twoClassDetectManifest();
    const { manifest: next, classKey } = addClfClassToManifest(m, "Person");
    expect(classKey).toBe("person");
    expect(next.tasks.clf.classKeys).toEqual(["person"]);
    expect(next.classDefs.filter((def) => def.name === "Person")).toHaveLength(1);
    expect(classificationOptionsForNewAnnotations(next).map((def) => def.key)).toEqual(["person"]);
  });
});

// ---------------------------------------------------------------------------
// archiveClfClassInManifest + unarchiveClfClassInManifest
// ---------------------------------------------------------------------------

describe("archiveClfClassInManifest", () => {
  it("removes from clf classKeys and marks archived", () => {
    const m = bothTaskManifest();
    const next = archiveClfClassInManifest(m, "day");
    expect(next.tasks.clf.classKeys).not.toContain("day");
    expect(next.classDefs.find((d) => d.key === "day")?.archived).toBe(true);
  });

  it("does not affect detect classKeys", () => {
    const m = bothTaskManifest();
    const next = archiveClfClassInManifest(m, "day");
    expect(next.tasks.detect.classKeys).toEqual(["person", "car"]);
  });
});

describe("unarchiveClfClassInManifest", () => {
  it("re-adds to clf classKeys and unsets archived", () => {
    const m = archiveClfClassInManifest(bothTaskManifest(), "day");
    const restored = unarchiveClfClassInManifest(m, "day");
    expect(restored.tasks.clf.classKeys).toContain("day");
    expect(restored.classDefs.find((d) => d.key === "day")?.archived).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// upgradeLegacyToManifest
// ---------------------------------------------------------------------------

describe("upgradeLegacyToManifest", () => {
  it("preserves class order as detect YOLO IDs", () => {
    const legacy = [{ id: 2, name: "Truck" }, { id: 0, name: "Person" }, { id: 1, name: "Car" }];
    const m = upgradeLegacyToManifest(legacy);
    expect(m.tasks.detect.classKeys[0]).toBe(m.classDefs.find((d) => d.name === "Person")!.key);
    expect(m.tasks.detect.classKeys[1]).toBe(m.classDefs.find((d) => d.name === "Car")!.key);
    expect(m.tasks.detect.classKeys[2]).toBe(m.classDefs.find((d) => d.name === "Truck")!.key);
  });

  it("generates slug keys", () => {
    const legacy = [{ id: 0, name: "My Person Class" }];
    const m = upgradeLegacyToManifest(legacy);
    expect(m.classDefs[0].key).toMatch(/^[a-z0-9_-]+$/);
  });

  it("deduplicates colliding slugs", () => {
    const legacy = [{ id: 0, name: "Person" }, { id: 1, name: "person" }];
    const m = upgradeLegacyToManifest(legacy);
    const keys = m.classDefs.map((d) => d.key);
    expect(new Set(keys).size).toBe(2);
  });

  it("clf classKeys is empty (no info in legacy)", () => {
    const m = upgradeLegacyToManifest([{ id: 0, name: "car" }]);
    expect(m.tasks.clf.classKeys).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// manifestToLegacyClasses
// ---------------------------------------------------------------------------

describe("manifestToLegacyClasses", () => {
  it("returns detect classes in YOLO id order", () => {
    const m = twoClassDetectManifest();
    const legacy = manifestToLegacyClasses(m);
    expect(legacy[0]).toEqual({ id: 0, name: "Person" });
    expect(legacy[1]).toEqual({ id: 1, name: "Car" });
  });

  it("includes archived detect classes to preserve IDs", () => {
    const m = archiveDetectClassInManifest(twoClassDetectManifest(), "person");
    const legacy = manifestToLegacyClasses(m);
    // person must remain at id 0 even though archived
    expect(legacy[0]).toEqual({ id: 0, name: "Person" });
    expect(legacy[1]).toEqual({ id: 1, name: "Car" });
  });
});

// ---------------------------------------------------------------------------
// validateNewClassName
// ---------------------------------------------------------------------------

describe("validateNewClassName", () => {
  it("passes valid unique name", () => {
    expect(validateNewClassName("truck", ["person", "car"])).toHaveLength(0);
  });

  it("rejects empty name", () => {
    const errors = validateNewClassName("", ["person"]);
    expect(errors.some((e) => e.toLowerCase().includes("empty"))).toBe(true);
  });

  it("rejects whitespace-only name", () => {
    const errors = validateNewClassName("   ", ["person"]);
    expect(errors.some((e) => e.toLowerCase().includes("empty"))).toBe(true);
  });

  it("rejects case-insensitive duplicate", () => {
    const errors = validateNewClassName("Person", ["person", "car"]);
    expect(errors.some((e) => e.toLowerCase().includes("already exists"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// allDetectClassDefs / activeDetectClassDefs / activeClfClassDefs / archivedClassDefs
// ---------------------------------------------------------------------------

describe("display helpers", () => {
  it("allDetectClassDefs returns all detect defs with yoloId", () => {
    const m = twoClassDetectManifest();
    const defs = allDetectClassDefs(m);
    expect(defs).toHaveLength(2);
    expect(defs[0].yoloId).toBe(0);
    expect(defs[1].yoloId).toBe(1);
  });

  it("allDetectClassDefs includes archived defs", () => {
    const m = archiveDetectClassInManifest(twoClassDetectManifest(), "person");
    expect(allDetectClassDefs(m)).toHaveLength(2); // still 2, id 0 still exists
  });

  it("activeDetectClassDefs excludes archived", () => {
    const m = archiveDetectClassInManifest(twoClassDetectManifest(), "person");
    const active = activeDetectClassDefs(m);
    expect(active).toHaveLength(1);
    expect(active[0].key).toBe("car");
  });

  it("activeClfClassDefs excludes archived clf classes", () => {
    const m = archiveClfClassInManifest(bothTaskManifest(), "day");
    const active = activeClfClassDefs(m);
    expect(active.map((d) => d.key)).not.toContain("day");
    expect(active.map((d) => d.key)).toContain("night");
  });

  it("archivedClassDefs returns archived defs only", () => {
    const m = archiveDetectClassInManifest(
      archiveClfClassInManifest(bothTaskManifest(), "day"),
      "person"
    );
    const archived = archivedClassDefs(m);
    expect(archived.map((d) => d.key)).toContain("person");
    expect(archived.map((d) => d.key)).toContain("day");
    expect(archived.map((d) => d.key)).not.toContain("car");
    expect(archived.map((d) => d.key)).not.toContain("night");
  });
});

// ---------------------------------------------------------------------------
// Phase 4C active vs archived consumption helpers
// ---------------------------------------------------------------------------

describe("Phase 4C consumption helpers", () => {
  it("archived detect class remains addressable at the same YOLO id", () => {
    const m = archiveDetectClassInManifest(twoClassDetectManifest(), "person");
    expect(archivedDetectClassIds(m)).toEqual(new Set([0]));
    expect(findDetectClassById(m, 0)?.key).toBe("person");
    expect(findDetectClassByKey(m, "person")?.yoloId).toBe(0);
    expect(isDetectClassArchivedById(m, 0)).toBe(true);
    expect(isDetectClassArchived(m, "person")).toBe(true);
  });

  it("active detect options exclude archived classes without compacting ids", () => {
    const m = archiveDetectClassInManifest(twoClassDetectManifest(), "person");
    const allClasses = manifestToLegacyClasses(m);
    expect(activeDetectClasses(m)).toEqual([{ id: 1, name: "Car" }]);
    expect(detectClassOptionsForNewAnnotations(m, allClasses)).toEqual([{ id: 1, name: "Car" }]);
  });

  it("detect display and export still include archived slots in order", () => {
    const m = archiveDetectClassInManifest(twoClassDetectManifest(), "person");
    expect(detectClassDisplayName(m, 0)).toBe("Person");
    expect(exportDetectClassNamesPreservingIds(m)).toEqual(["Person", "Car"]);
  });

  it("active classification options exclude archived classes while display lookup still works", () => {
    const m = archiveClfClassInManifest(bothTaskManifest(), "day");
    expect(activeClassificationClasses(m).map((d) => d.key)).toEqual(["night"]);
    expect(classificationOptionsForNewAnnotations(m).map((d) => d.key)).toEqual(["night"]);
    expect(findClassificationClassByKey(m, "day")?.name).toBe("Day");
    expect(isClassificationClassArchived(m, "day")).toBe(true);
    expect(classificationClassDisplayName(m, "day")).toBe("Day");
  });

  it("chooses the manifest with more active classification classes", () => {
    const detectOnly = twoClassDetectManifest();
    const both = bothTaskManifest();
    expect(chooseClassificationManifest(detectOnly, both)).toBe(both);
    expect(chooseClassificationManifest(both, detectOnly)).toBe(both);
    expect(chooseClassificationManifest(detectOnly, null)).toBe(detectOnly);
  });

  it("legacy classes.txt adaptation preserves order", () => {
    const legacy = [{ id: 1, name: "Car" }, { id: 0, name: "Person" }];
    const m = upgradeLegacyToManifest(legacy);
    expect(manifestToLegacyClasses(m)).toEqual([
      { id: 0, name: "Person" },
      { id: 1, name: "Car" },
    ]);
  });
});
