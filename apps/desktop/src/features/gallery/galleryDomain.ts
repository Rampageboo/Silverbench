import type {
  GalleryAsset,
  GalleryJob,
  GalleryTag,
  GalleryUserEdits,
  PromptOptions,
  PromptValue,
  TagCategory
} from "./galleryApi";

export type PromptFormat = "noobai" | "anima";
export type PromptField = "positive" | "negative";

// ── Content rating ───────────────────────────────────────────────────────────

/**
 * contentRating is the strongest inferred rating tag, or null when nothing was
 * inferred. It is not a calibrated safety verdict, so anything other than an
 * explicit "general" is treated as unknown-or-adult and hidden by default.
 */
export function shouldObscure(contentRating: string | null | undefined, revealAll: boolean): boolean {
  if (revealAll) return false;
  return contentRating !== "general";
}

export const CONTENT_RATING_LABELS: Record<string, string> = {
  general: "General",
  sensitive: "Sensitive",
  questionable: "Questionable",
  explicit: "Explicit"
};

export function contentRatingLabel(value: string | null | undefined) {
  return value ? (CONTENT_RATING_LABELS[value] ?? value) : "Unrated";
}

// ── Provenance ───────────────────────────────────────────────────────────────

/** Locations added before the English UI stored these source labels verbatim. */
const LEGACY_ROOT_SOURCES: Record<string, string> = {
  "ComfyUI 输出": "ComfyUI output",
  下载图集: "Downloads",
  训练集: "Training set",
  "Blender 渲染": "Blender renders",
  其他: "Other"
};

export function rootSourceLabel(source: string) {
  return LEGACY_ROOT_SOURCES[source] ?? source;
}

export const PROMPT_SOURCE_LABELS: Record<
  string,
  { label: string; tone: "ok" | "info" | "accent" | "warn" | "muted" }
> = {
  metadata: { label: "Original metadata", tone: "ok" },
  "derived-metadata": { label: "Converted from metadata", tone: "info" },
  "derived-model": { label: "Model tagger", tone: "accent" },
  user: { label: "Edited", tone: "warn" },
  none: { label: "No source", tone: "muted" }
};

export function promptSourceLabel(source: string | null | undefined) {
  return (
    PROMPT_SOURCE_LABELS[source || "none"] ?? { label: source || "Unknown source", tone: "muted" as const }
  );
}

export const METADATA_FORMAT_LABELS: Record<string, string> = {
  a1111: "A1111 / Forge",
  comfyui: "ComfyUI",
  novelai: "NovelAI",
  none: "No metadata"
};

export const TAG_CATEGORY_LABELS: Record<TagCategory, string> = {
  quality: "Quality",
  rating: "Rating",
  count: "Count",
  character: "Character",
  copyright: "Copyright",
  artist: "Artist",
  general: "General"
};

export const TAG_CATEGORY_ORDER: TagCategory[] = [
  "quality",
  "rating",
  "count",
  "character",
  "copyright",
  "artist",
  "general"
];

export function groupTags(tags: GalleryTag[]) {
  const groups = new Map<TagCategory, GalleryTag[]>();
  for (const tag of tags) {
    const list = groups.get(tag.category) ?? [];
    list.push(tag);
    groups.set(tag.category, list);
  }
  return TAG_CATEGORY_ORDER.filter((category) => groups.has(category)).map((category) => ({
    category,
    tags: groups.get(category)!
  }));
}

/** Metadata tags carry no probability: show provenance, never a fake 0% / 100%. */
export function formatProbability(probability: number | null | undefined): string | null {
  if (probability === null || probability === undefined || !Number.isFinite(probability)) return null;
  return `${Math.round(probability * 100)}%`;
}

// ── Edits ────────────────────────────────────────────────────────────────────

/**
 * Set or clear one per-format override without touching the other format or
 * field. `value === undefined` removes the override (falls back to automatic);
 * an explicit "" is a real override meaning "the user cleared it".
 */
export function withPromptOverride(
  edits: GalleryUserEdits,
  format: PromptFormat,
  field: PromptField,
  value: string | undefined
): GalleryUserEdits {
  const current: PromptValue = { ...(edits[format] ?? {}) };
  if (value === undefined) delete current[field];
  else current[field] = value;
  const next: GalleryUserEdits = { ...edits };
  if (Object.keys(current).length) next[format] = current;
  else delete next[format];
  return next;
}

export function promptOverride(
  edits: GalleryUserEdits,
  format: PromptFormat,
  field: PromptField
): string | undefined {
  return edits[format]?.[field];
}

/** Editable fields of one asset, held per asset id until saved. */
export type AssetDraft = {
  rating: number;
  collection: string;
  personalTags: string;
  notes: string;
  caption?: string;
  aiRequestId?: string;
  userEdits: GalleryUserEdits;
};

export function draftFromAsset(
  asset: Pick<GalleryAsset, "rating" | "collection" | "personalTags" | "notes" | "userEdits"> & {
    caption?: string;
  }
): AssetDraft {
  return {
    rating: asset.rating,
    collection: asset.collection,
    personalTags: asset.personalTags.join(", "),
    notes: asset.notes,
    caption: asset.caption ?? "",
    userEdits: structuredClone(asset.userEdits ?? {})
  };
}

export function parsePersonalTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,，\n]/)) {
    const tag = part.trim();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Only fields that actually differ; userEdits is sent whole (the API replaces it). */
export function draftPatch(
  asset: Pick<GalleryAsset, "rating" | "collection" | "personalTags" | "notes" | "userEdits"> & {
    caption?: string;
  },
  draft: AssetDraft
) {
  const patch: Partial<
    Pick<GalleryAsset, "rating" | "collection" | "personalTags" | "notes" | "userEdits" | "caption">
  > = {};
  if (draft.rating !== asset.rating) patch.rating = draft.rating;
  if (draft.collection !== asset.collection) patch.collection = draft.collection;
  const tags = parsePersonalTags(draft.personalTags);
  if (!sameJson(tags, asset.personalTags)) patch.personalTags = tags;
  if (draft.notes !== asset.notes) patch.notes = draft.notes;
  if (draft.caption !== undefined && draft.caption !== (asset.caption ?? "")) patch.caption = draft.caption;
  if (!sameJson(draft.userEdits, asset.userEdits ?? {})) patch.userEdits = draft.userEdits;
  return patch;
}

// ── Prompt options ───────────────────────────────────────────────────────────

export type GalleryMode = "prompt" | "train";

export const MODE_THRESHOLDS: Record<GalleryMode, { general: number; character: number }> = {
  prompt: { general: 0.3, character: 0.75 },
  train: { general: 0.45, character: 0.85 }
};

export type GalleryRules = {
  generalThreshold: number | null;
  characterThreshold: number | null;
  trigger: string;
  outfitTrigger: string;
  removeTags: string;
  corrections: string;
  captionStyle: "mixed" | "tags" | "natural";
  trainingKind: "character" | "style";
  sourceTag: string;
};

export const DEFAULT_RULES: GalleryRules = {
  generalThreshold: null,
  characterThreshold: null,
  trigger: "",
  outfitTrigger: "",
  removeTags: "",
  corrections: "",
  captionStyle: "mixed",
  trainingKind: "character",
  sourceTag: ""
};

/** "cross = star (symbol)" per line → { cross: "star (symbol)" }. */
export function parseCorrections(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(.+?)\s*(?:=>|=|→)\s*(.*?)\s*$/);
    if (match && match[1]) out[match[1]] = match[2];
  }
  return out;
}

/**
 * Options for preview/summary/export. Thresholds left null use the backend's
 * per-mode defaults; training-only fields are sent only in training mode.
 */
export function buildPromptOptions(mode: GalleryMode, rules: GalleryRules): PromptOptions {
  const options: PromptOptions = { mode };
  if (rules.generalThreshold !== null) options.generalThreshold = rules.generalThreshold;
  if (rules.characterThreshold !== null) options.characterThreshold = rules.characterThreshold;
  options.captionStyle = rules.captionStyle;
  if (mode === "train") {
    if (rules.trigger.trim()) options.trigger = rules.trigger.trim();
    if (rules.outfitTrigger.trim()) options.outfitTrigger = rules.outfitTrigger.trim();
    const remove = parsePersonalTags(rules.removeTags);
    if (remove.length) options.removeTags = remove;
    const corrections = parseCorrections(rules.corrections);
    if (Object.keys(corrections).length) options.corrections = corrections;
    options.trainingKind = rules.trainingKind;
    if (rules.sourceTag.trim()) options.sourceTag = rules.sourceTag.trim();
  }
  return options;
}

/** True when the plain asset response (backend defaults) already matches the options. */
export function isDefaultPromptOptions(options: PromptOptions) {
  return sameJson(options, { mode: "prompt", captionStyle: "mixed" });
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export const JOB_STATUS_LABELS: Record<GalleryJob["status"], string> = {
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed"
};

export const JOB_TYPE_LABELS: Record<GalleryJob["type"], string> = {
  scan: "Scan",
  wd: "WD tagging",
  control: "Control maps"
};

export function isActiveJob(job: GalleryJob) {
  return job.status === "queued" || job.status === "running" || job.status === "paused";
}

/**
 * Changes whenever any job advances, finishes or appears. Completion must
 * count too: a fast scan can start and finish between two polls.
 */
export function jobsSignature(jobs: GalleryJob[], total: number) {
  return `${total}|${jobs.map((job) => `${job.id}:${job.status}:${job.processed}:${job.modifiedAt}`).join(",")}`;
}

/** Scans do not know their total up front; report counts, never an invented percentage. */
export function jobProgressText(job: GalleryJob) {
  const p = job.progress ?? ({} as GalleryJob["progress"]);
  const parts = [`Processed ${p.processed ?? p.scanned ?? job.processed ?? 0}`];
  if (p.imported) parts.push(`New ${p.imported}`);
  if (p.skipped) parts.push(`Skipped ${p.skipped}`);
  if (p.missing) parts.push(`Offline ${p.missing}`);
  if (p.errors?.length) parts.push(`Errors ${p.errors.length}`);
  return parts.join(" · ");
}
