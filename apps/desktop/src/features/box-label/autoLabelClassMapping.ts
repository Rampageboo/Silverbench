import type * as api from "../../api";

export function normalizeAutoLabelClassName(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function buildClassIdByName(
  classes: Array<{ id: number; key?: string; name: string; aliases?: string[] }>
) {
  const byName = new Map<string, number>();
  const addName = (value: unknown, id: number) => {
    const key = normalizeAutoLabelClassName(value);
    if (key && !byName.has(key)) byName.set(key, id);
  };
  [...classes]
    .sort((a, b) => a.id - b.id)
    .forEach((item) => {
      addName(item.name, item.id);
      addName(item.key, item.id);
      for (const alias of item.aliases ?? []) addName(alias, item.id);
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
