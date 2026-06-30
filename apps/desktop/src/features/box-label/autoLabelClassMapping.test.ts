import { describe, expect, it } from "vitest";
import { buildClassIdByName, resolveAutoLabelClassId } from "./autoLabelClassMapping";

describe("auto label class mapping", () => {
  it("maps model class names to workspace detect class ids", () => {
    const byName = buildClassIdByName([
      { id: 15, name: "Fissure" },
      { id: 34, name: "EnemyAttack" },
    ]);

    expect(resolveAutoLabelClassId({ classId: 34, className: "Fissure" }, byName)).toBe(15);
  });

  it("maps previous names and stable keys to renamed workspace classes", () => {
    const byName = buildClassIdByName([
      { id: 12, key: "go", name: "Teleport", aliases: ["GO"] },
      { id: 15, key: "fissure", name: "Crack", aliases: ["Fissure"] },
    ]);

    expect(resolveAutoLabelClassId({ classId: 2, className: "GO" }, byName)).toBe(12);
    expect(resolveAutoLabelClassId({ classId: 34, className: "Fissure" }, byName)).toBe(15);
  });

  it("falls back to the model class id when className is missing from the workspace", () => {
    const byName = buildClassIdByName([{ id: 15, name: "Fissure" }]);

    expect(resolveAutoLabelClassId({ classId: 34, className: "UnknownModelClass" }, byName)).toBe(34);
    expect(resolveAutoLabelClassId({ classId: 7 }, byName)).toBe(7);
  });
});
