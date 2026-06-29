import { readTextFile, writeTextFile } from "../../api";

export const AUTO_LABEL_RUNS_REL_PATH = "workspace/auto_label_runs.json";

type AutoLabelRunRegistry = {
  version: 1;
  keys: string[];
};

function parseAutoLabelRunRegistry(text: string): AutoLabelRunRegistry {
  const parsed = JSON.parse(text) as Partial<AutoLabelRunRegistry>;
  const keys = Array.isArray(parsed.keys)
    ? parsed.keys.map((key) => String(key).trim()).filter(Boolean)
    : [];
  return {
    version: 1,
    keys: [...new Set(keys)].sort(),
  };
}

export async function readAutoLabelRunKeys(workspaceRoot: string): Promise<Set<string>> {
  try {
    const text = await readTextFile(workspaceRoot, AUTO_LABEL_RUNS_REL_PATH);
    return new Set(parseAutoLabelRunRegistry(text).keys);
  } catch {
    return new Set();
  }
}

export async function writeAutoLabelRunKeys(workspaceRoot: string, keys: ReadonlySet<string>): Promise<void> {
  const payload: AutoLabelRunRegistry = {
    version: 1,
    keys: [...keys].sort(),
  };
  await writeTextFile(workspaceRoot, AUTO_LABEL_RUNS_REL_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

