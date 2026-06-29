import { callJson, readTextFile, writeTextFile } from "../../api";
import {
  REGISTRY_REL_PATH,
  modelDestPath,
  modelFilename,
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

export async function writeAutoLabelModelRegistry(
  workspaceRoot: string,
  registry: AutoLabelModelRegistry
): Promise<void> {
  await writeTextFile(workspaceRoot, REGISTRY_REL_PATH, JSON.stringify(registry, null, 2));
}

async function copyModelToWorkspace(
  sourcePath: string,
  workspaceRoot: string,
  relDest: string
): Promise<void> {
  await callJson<string>("copyModelToWorkspace", [sourcePath, workspaceRoot, relDest]);
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

export async function importAutoLabelDetectModel(
  workspaceRoot: string,
  sourcePath: string
): Promise<string> {
  if (!validatePtExtension(sourcePath)) throw new Error("Only .pt model files are supported.");
  const relDest = modelDestPath("detect", modelFilename(sourcePath));
  await copyModelToWorkspace(sourcePath, workspaceRoot, relDest);
  return relDest;
}

export async function importAutoLabelClassifyModel(
  workspaceRoot: string,
  sourcePath: string
): Promise<string> {
  if (!validatePtExtension(sourcePath)) throw new Error("Only .pt model files are supported.");
  const relDest = modelDestPath("classify", modelFilename(sourcePath));
  await copyModelToWorkspace(sourcePath, workspaceRoot, relDest);
  return relDest;
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
