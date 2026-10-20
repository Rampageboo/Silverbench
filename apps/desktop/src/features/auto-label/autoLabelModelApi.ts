import { callJson, readTextFile } from "../../api";
import {
  REGISTRY_REL_PATH,
  parseModelRegistry,
  validatePtExtension,
  type AutoLabelModelKind,
  type AutoLabelModelRegistry,
} from "./autoLabelModelRegistry";

export type { AutoLabelModelKind, AutoLabelModelRegistry };

export async function readAutoLabelModelRegistry(workspaceRoot: string): Promise<AutoLabelModelRegistry> {
  try {
    return await callJson<AutoLabelModelRegistry>("readAutoLabelModelRegistry", [workspaceRoot]);
  } catch {
    try {
      const text = await readTextFile(workspaceRoot, REGISTRY_REL_PATH);
      return parseModelRegistry(text);
    } catch {
      return {};
    }
  }
}

async function importModelViaBackend(
  workspaceRoot: string,
  sourcePath: string,
  kind: AutoLabelModelKind
): Promise<AutoLabelModelRegistry> {
  return callJson<AutoLabelModelRegistry>("importAutoLabelModel", [
    sourcePath,
    workspaceRoot,
    kind,
    new Date().toISOString(),
  ]);
}

export async function pickAndImportAutoLabelModel(
  workspaceRoot: string,
  kind: AutoLabelModelKind
): Promise<AutoLabelModelRegistry | null> {
  const title = kind === "detect" ? "Choose Detect Model (.pt)" : "Choose Classification Model (.pt)";
  const sourcePath = await callJson<string>("chooseTrainModelFile", [title]);
  if (!sourcePath) return null;
  if (!validatePtExtension(sourcePath)) throw new Error("Only .pt model files are supported.");
  return importModelViaBackend(workspaceRoot, sourcePath, kind);
}
