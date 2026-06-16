import { listDatasetFiles, writeFileBase64, writeTextFile } from "../../api";
import { classificationClassNameForPath } from "../dataset-review/datasetCore";
import type { MergeTask } from "./mergeApi";
import {
  chooseClassifyImageDestination,
  chooseTrainImageDestination,
  ext,
  findDatasetYamlPath,
  IMAGE_EXTENSIONS,
  labelSourceForImage,
  normalizeDatasetRoot,
  sortPaths,
  trainLabelPathForImage
} from "./mergePlan";
import { blobToBase64, collectZipSourceFiles, sourceBlob, sourceText, type FileSource } from "./mergeZip";

export type MergeSource =
  | { kind: "folder"; root: string; name: string }
  | { kind: "zip"; name: string; buffer: ArrayBuffer };

export type MergeStats = {
  copied: number;
  renamed: number;
  skipped: number;
  failed: number;
  emptyLabels: number;
  noClass: number;
};

export type MergeProgress = {
  value: number;
  total: number;
  detail: string;
};

type CopyTask = {
  path: string;
  destination: string;
  fileSource: FileSource;
  sourceName: string;
};

async function collectBackendSourceFiles(rootPath: string, out: Map<string, FileSource>) {
  const paths = await listDatasetFiles(rootPath);
  for (const path of paths) out.set(path, { kind: "backend", root: rootPath, path });
}

async function copySourceFileToBackend(rootPath: string, path: string, source: FileSource) {
  const blob = await sourceBlob(source);
  if (blob.type.startsWith("text/") || /\.(txt|yaml|yml|json|csv)$/i.test(path)) {
    await writeTextFile(rootPath, path, await blob.text());
    return;
  }
  await writeFileBase64(rootPath, path, await blobToBase64(blob));
}

async function findDifferingYaml(
  yamlCandidates: Array<{ sourceName: string; path: string; fileSource: FileSource }>
) {
  if (yamlCandidates.length < 2) return null;
  const first = (await sourceText(yamlCandidates[0].fileSource)).trim();
  for (const candidate of yamlCandidates.slice(1)) {
    if ((await sourceText(candidate.fileSource)).trim() !== first) return candidate;
  }
  return null;
}

export async function mergeDatasets(options: {
  sources: MergeSource[];
  targetRoot: string;
  task: MergeTask;
  autoRename: boolean;
  onProgress?: (progress: MergeProgress) => void;
  onLog?: (line: string) => void;
}) {
  const { sources, targetRoot, task, autoRename, onProgress, onLog } = options;
  const existing = new Set<string>();
  const reserved = new Set<string>();
  const stats: MergeStats = { copied: 0, renamed: 0, skipped: 0, failed: 0, emptyLabels: 0, noClass: 0 };
  const log: string[] = [`Task: ${task}`, `Target: ${targetRoot}`];
  const copyTasks: CopyTask[] = [];
  const trainLines: string[] = [];
  const yamlCandidates: Array<{ sourceName: string; path: string; fileSource: FileSource }> = [];

  onProgress?.({ value: 0, total: 1, detail: "Scanning target folder..." });
  const targetFiles = await listDatasetFiles(targetRoot);
  for (const path of targetFiles) existing.add(path.toLowerCase());
  log.push(`Target currently has ${existing.size} file(s).`);

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = sources[sourceIndex];
    const prefix = `d${sourceIndex + 1}_`;
    onProgress?.({ value: 0, total: 1, detail: `Planning ${source.name}...` });
    const sourceFiles = new Map<string, FileSource>();
    if (source.kind === "folder") await collectBackendSourceFiles(source.root, sourceFiles);
    else await collectZipSourceFiles(source.buffer, sourceFiles);

    const normalizedSourceFiles = normalizeDatasetRoot(sourceFiles, task);
    const entries = sortPaths([...normalizedSourceFiles.keys()]).map((path) => [path, normalizedSourceFiles.get(path)!] as const);
    const pathPlan = new Map<string, string>();

    if (task === "detect") {
      const yamlPath = findDatasetYamlPath(normalizedSourceFiles as Map<string, unknown>);
      if (yamlPath) {
        yamlCandidates.push({ sourceName: source.name, path: yamlPath, fileSource: normalizedSourceFiles.get(yamlPath)! });
      }
    }
    log.push(`\n${source.name}: ${entries.length} file(s), prefix ${prefix}`);

    for (const [path] of entries) {
      if (!IMAGE_EXTENSIONS.has(ext(path))) continue;
      const destination =
        task === "classify"
          ? chooseClassifyImageDestination(path, prefix, existing, reserved, autoRename)
          : chooseTrainImageDestination(path, prefix, existing, reserved, autoRename);
      if (!destination) {
        stats.skipped += 1;
        if (task === "classify" && !classificationClassNameForPath(path)) {
          stats.noClass += 1;
          log.push(`SKIP no class folder: ${path}`);
        } else {
          log.push(`SKIP conflict: ${path}`);
        }
        continue;
      }
      pathPlan.set(path, destination);
      reserved.add(destination.toLowerCase());
      if (task === "detect") {
        trainLines.push(destination);
        const labelDestination = trainLabelPathForImage(destination);
        const labelSource = labelSourceForImage(path, normalizedSourceFiles as Map<string, unknown>);
        if (labelSource) pathPlan.set(labelSource, labelDestination);
        else {
          copyTasks.push({ path: `${path} (empty label)`, destination: labelDestination, fileSource: { kind: "text", text: "" }, sourceName: source.name });
          stats.emptyLabels += 1;
          log.push(`EMPTY label created for ${path}`);
        }
        reserved.add(labelDestination.toLowerCase());
      }
    }

    for (const [path, fileSource] of entries) {
      const destination = pathPlan.get(path);
      if (!destination) continue;
      copyTasks.push({ path, destination, fileSource, sourceName: source.name });
    }
  }

  if (task === "detect" && yamlCandidates.length) {
    copyTasks.unshift({
      path: yamlCandidates[0].path,
      destination: "data.yaml",
      fileSource: yamlCandidates[0].fileSource,
      sourceName: yamlCandidates[0].sourceName
    });
    const differingYaml = await findDifferingYaml(yamlCandidates);
    if (differingYaml) log.push(`WARNING data.yaml differs: ${differingYaml.sourceName}/${differingYaml.path}.`);
    else log.push(`Copied ${yamlCandidates[0].sourceName}/${yamlCandidates[0].path} as data.yaml.`);
  } else if (task === "detect") {
    log.push("WARNING no data.yaml found in sources.");
  }

  if (task === "detect") {
    copyTasks.push({
      path: "generated train.txt",
      destination: "train.txt",
      fileSource: { kind: "text", text: `${trainLines.join("\n")}${trainLines.length ? "\n" : ""}` },
      sourceName: "merge"
    });
  }

  const total = copyTasks.length;
  log.push(`\nCopying ${total} file(s)...`);
  onProgress?.({ value: 0, total, detail: total ? `Copying 0 / ${total}...` : "Nothing to copy." });

  for (let index = 0; index < copyTasks.length; index += 1) {
    const copyTask = copyTasks[index];
    onProgress?.({ value: index, total, detail: `${copyTask.sourceName}\n${copyTask.destination}` });
    try {
      await copySourceFileToBackend(targetRoot, copyTask.destination, copyTask.fileSource);
      existing.add(copyTask.destination.toLowerCase());
      stats.copied += 1;
      if (copyTask.destination !== copyTask.path) {
        stats.renamed += 1;
        log.push(`RENAMED ${copyTask.path} -> ${copyTask.destination}`);
      }
    } catch (err) {
      stats.failed += 1;
      log.push(`FAILED ${copyTask.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    onProgress?.({ value: index + 1, total, detail: copyTask.destination });
  }

  const classNote = task === "classify" ? `, no class ${stats.noClass}` : "";
  const labelNote = task === "detect" ? `, empty labels ${stats.emptyLabels}` : "";
  const summary = `Done. Copied ${stats.copied}, renamed ${stats.renamed}, skipped ${stats.skipped}, failed ${stats.failed}${labelNote}${classNote}.`;
  log.push(`\n${summary}`);
  onLog?.(log.join("\n"));
  onProgress?.({ value: total, total, detail: summary });
  return { stats, log: log.join("\n"), summary };
}
