import { WORKSPACE_PATHS } from "../../workspace/layout";
export type AutoLabelModelKind = "detect" | "classify";

export type AutoLabelModelEntry = {
  activeModel: string;
  updatedAt: string;
};

export type AutoLabelModelRegistry = {
  detect?: AutoLabelModelEntry | null;
  classify?: AutoLabelModelEntry | null;
};

export const REGISTRY_REL_PATH = WORKSPACE_PATHS.modelRegistry;

export function detectModelDestPath(filename: string): string {
  return `models/autolabel/detect/${filename}`;
}

export function classifyModelDestPath(filename: string): string {
  return `models/autolabel/classify/${filename}`;
}

export function modelDestPath(kind: AutoLabelModelKind, filename: string): string {
  return kind === "detect" ? detectModelDestPath(filename) : classifyModelDestPath(filename);
}

export function modelFilename(sourcePath: string): string {
  return sourcePath.replace(/\\/g, "/").split("/").at(-1) ?? sourcePath;
}

export function validatePtExtension(sourcePath: string): boolean {
  return sourcePath.toLowerCase().endsWith(".pt");
}

export function parseModelRegistry(json: string): AutoLabelModelRegistry {
  try {
    return JSON.parse(json) as AutoLabelModelRegistry;
  } catch {
    return {};
  }
}

export function updateRegistry(
  existing: AutoLabelModelRegistry,
  kind: AutoLabelModelKind,
  relPath: string,
  updatedAt: string
): AutoLabelModelRegistry {
  return { ...existing, [kind]: { activeModel: relPath, updatedAt } };
}

export function activeModelFilename(entry: AutoLabelModelEntry | null | undefined): string | null {
  if (!entry?.activeModel) return null;
  return modelFilename(entry.activeModel);
}
