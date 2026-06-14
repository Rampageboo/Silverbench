import { INBOX_JUNK_CLASS, isDetectJunk, isClfJunk } from "../image-pool/metadata";
import type { MetadataRow } from "../image-pool/types";
import type { ImagePoolItem } from "../../api";
import type { InboxFilter, InboxItem } from "./types";
import { metadataSideState } from "./types";

export function inboxClassTagForFile(filename: string, metadata: Map<string, MetadataRow>) {
  const row = metadata.get(filename);
  if (isClfJunk(row) && isDetectJunk(row)) return "Both junk";
  if (isClfJunk(row)) return "Clf junk";
  if (isDetectJunk(row)) return "Detect junk";
  if (!row) return "Unassigned";
  const detectOn = row.detect_enabled === "1" || row.detect_enabled === true;
  const clfOn = row.clf_enabled === "1" || row.clf_enabled === true;
  if (detectOn && clfOn && row.clf_class) return `detect + clf: ${row.clf_class}`;
  if (detectOn) return "detect";
  if (clfOn && row.clf_class) return `clf: ${row.clf_class}`;
  if (row.clf_class) return `clf: ${row.clf_class}`;
  return "Unassigned";
}

export function inboxHasNoAssignmentMetadata(row: MetadataRow | undefined) {
  const side = metadataSideState(row);
  return !side.detectInUse && !side.clfInUse && !side.detectRejected && !side.clfRejected;
}

export function inboxIsUnusedForDataset(
  filename: string,
  metadata: Map<string, MetadataRow>,
  poolItem: ImagePoolItem | undefined
) {
  const side = metadataSideState(metadata.get(filename));
  return !side.detectInUse && !side.clfInUse && !poolItem?.isUsed && !isClfJunk(metadata.get(filename)) && !isDetectJunk(metadata.get(filename));
}

function shuffle<T>(items: T[]) {
  const shuffled = items.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function chooseRandomUnusedSample(
  files: ImagePoolItem[],
  metadata: Map<string, MetadataRow>
) {
  const candidates = files.filter((item) => inboxIsUnusedForDataset(item.filename, metadata, item));
  const sample = shuffle(candidates)
    .slice(0, 100)
    .map((item) => item.filename);
  return { filenames: new Set(sample), candidateCount: candidates.length };
}

export function filterInboxItems(
  files: ImagePoolItem[],
  metadata: Map<string, MetadataRow>,
  filter: InboxFilter,
  randomUnused: Set<string>
): InboxItem[] {
  const sorted = [...files].sort((a, b) =>
    a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: "base" })
  );
  return sorted
    .filter((item) => {
      const row = metadata.get(item.filename);
      if (filter === "new") return item.isNew;
      if (filter === "unassigned") return inboxHasNoAssignmentMetadata(row);
      if (filter === "random-unused") {
        return randomUnused.has(item.filename) && inboxIsUnusedForDataset(item.filename, metadata, item);
      }
      return true;
    })
    .map((item) => ({ ...item, imagePath: `image_pool/${item.filename}` }));
}

export function detectClassChipLabel(item: { id: number; name: string }) {
  const name = String(item.name || "").trim();
  return Number.isFinite(item.id) ? `${item.id}: ${name}` : name;
}

export { INBOX_JUNK_CLASS };
