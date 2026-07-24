import type { Element, Page, RelRect } from "./schema";
import type { ImageRect } from "../box-label/geometry";

export type ElementEntry = {
  name: string;
  path: string[];
  element: Element;
  structuralParent: string | null;
  parentName: string | null;
  depth: number;
};

export function elementEntries(elements: Record<string, Element>): ElementEntry[] {
  const entries: ElementEntry[] = [];
  const visit = (
    record: Record<string, Element>,
    parentPath: string[],
    structuralParent: string | null,
    depth: number
  ) => {
    for (const [name, element] of Object.entries(record)) {
      const path = [...parentPath, name];
      entries.push({
        name,
        path,
        element,
        structuralParent,
        parentName: structuralParent ?? element.in ?? null,
        depth
      });
      if (element.kind === "container" && element.children) {
        visit(element.children, path, name, depth + 1);
      }
    }
  };
  visit(elements, [], null, 0);
  return entries;
}

export function updateElementAtPath(
  elements: Record<string, Element>,
  path: string[],
  update: (element: Element) => Element
): Record<string, Element> {
  const [head, ...tail] = path;
  if (!head || !elements[head]) return elements;
  if (!tail.length) return { ...elements, [head]: update(elements[head]) };
  const parent = elements[head];
  if (parent.kind !== "container" || !parent.children) return elements;
  return {
    ...elements,
    [head]: {
      ...parent,
      children: updateElementAtPath(parent.children, tail, update)
    }
  };
}

export function deleteElementAtPath(
  elements: Record<string, Element>,
  path: string[]
): Record<string, Element> {
  const [head, ...tail] = path;
  if (!head || !elements[head]) return elements;
  if (!tail.length) {
    const next = { ...elements };
    delete next[head];
    return next;
  }
  const parent = elements[head];
  if (parent.kind !== "container" || !parent.children) return elements;
  return {
    ...elements,
    [head]: {
      ...parent,
      children: deleteElementAtPath(parent.children, tail)
    }
  };
}

function renameKey(record: Record<string, Element>, oldName: string, newName: string) {
  return Object.fromEntries(
    Object.entries(record).map(([name, element]) => [name === oldName ? newName : name, element])
  );
}

export function renameElementAtPath(
  elements: Record<string, Element>,
  path: string[],
  newName: string
): Record<string, Element> {
  const [head, ...tail] = path;
  const oldName = path[path.length - 1];
  if (!head || !elements[head]) return elements;
  let renamed: Record<string, Element>;
  if (!tail.length) {
    renamed = renameKey(elements, head, newName);
  } else {
    const parent = elements[head];
    if (parent.kind !== "container" || !parent.children) return elements;
    renamed = {
      ...elements,
      [head]: {
        ...parent,
        children: renameElementAtPath(parent.children, tail, newName)
      }
    };
  }
  return mapElements(renamed, (element) => (element.in === oldName ? { ...element, in: newName } : element));
}

export function mapElements(
  elements: Record<string, Element>,
  map: (element: Element) => Element
): Record<string, Element> {
  return Object.fromEntries(
    Object.entries(elements).map(([name, original]) => {
      let element = map(original);
      if (element.kind === "container" && element.children) {
        element = { ...element, children: mapElements(element.children, map) };
      }
      return [name, element];
    })
  );
}

function roundRatio(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function relRectFromReferenceBoxes(child: ImageRect, parent: ImageRect): RelRect | null {
  const width = parent.x2 - parent.x1;
  const height = parent.y2 - parent.y1;
  if (width <= 0 || height <= 0) return null;
  return [
    roundRatio((child.x1 - parent.x1) / width),
    roundRatio((child.y1 - parent.y1) / height),
    roundRatio((child.x2 - parent.x1) / width),
    roundRatio((child.y2 - parent.y1) / height)
  ];
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Convert a schema §12 pixel box `[x0,y0,x1,y1]` into the editor's normalized
 * ImageRect authoring space, dividing by the prediction frame size `[w,h]` and
 * clamping to [0,1]. Used when accepting a predicted DET box as an element.
 */
export function imageRectFromPixelBox(
  box: [number, number, number, number],
  imageSize: [number, number]
): ImageRect {
  const width = imageSize[0] > 0 ? imageSize[0] : 1;
  const height = imageSize[1] > 0 ? imageSize[1] : 1;
  return {
    x1: clamp01(box[0] / width),
    y1: clamp01(box[1] / height),
    x2: clamp01(box[2] / width),
    y2: clamp01(box[3] / height)
  };
}

export function referenceBoxFromRelRect(relRect: RelRect, parent: ImageRect): ImageRect {
  const width = parent.x2 - parent.x1;
  const height = parent.y2 - parent.y1;
  return {
    x1: parent.x1 + relRect[0] * width,
    y1: parent.y1 + relRect[1] * height,
    x2: parent.x1 + relRect[2] * width,
    y2: parent.y1 + relRect[3] * height
  };
}

export function resolveReferenceBoxes(
  page: Page,
  authored: Record<string, ImageRect>
): Record<string, ImageRect> {
  const entries = elementEntries(page.elements);
  const resolved: Record<string, ImageRect> = { ...authored };
  for (let pass = 0; pass < entries.length; pass += 1) {
    let changed = false;
    for (const entry of entries) {
      if (resolved[entry.name] || !entry.parentName || !entry.element.relRect) continue;
      const parent = resolved[entry.parentName];
      if (!parent) continue;
      resolved[entry.name] = referenceBoxFromRelRect(entry.element.relRect, parent);
      changed = true;
    }
    if (!changed) break;
  }
  return resolved;
}
