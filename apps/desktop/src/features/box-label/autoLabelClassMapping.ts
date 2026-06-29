import type * as api from "../../api";

export function normalizeAutoLabelClassName(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function buildClassIdByName(classes: Array<{ id: number; name: string }>) {
  const byName = new Map<string, number>();
  [...classes]
    .sort((a, b) => a.id - b.id)
    .forEach((item) => {
      const key = normalizeAutoLabelClassName(item.name);
      if (key && !byName.has(key)) byName.set(key, item.id);
    });
  return byName;
}

export function resolveAutoLabelClassId(
  prediction: Pick<api.PtDetectPrediction, "classId" | "className">,
  classIdByName: ReadonlyMap<string, number>
) {
  const classNameKey = normalizeAutoLabelClassName(prediction.className);
  const mappedId = classNameKey ? classIdByName.get(classNameKey) : undefined;
  if (mappedId !== undefined) return mappedId;
  return Math.max(0, Math.trunc(Number(prediction.classId) || 0));
}
