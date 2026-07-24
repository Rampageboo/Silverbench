import type { ImagePoolItem } from "../../api";

export type ImagePoolFilter =
  | "all"
  | "new"
  | "unused"
  | "used"
  | "junk-detect"
  | "junk-clf"
  | "junk-both";

export type JunkScope = "detect" | "clf";
export type HideJunkMode = "detect" | "clf" | "both" | null;

export type MetadataRow = {
  filename: string;
  detect_junk?: boolean;
  clf_class?: string;
  detect_enabled?: boolean;
  clf_enabled?: boolean;
  detect_export_enabled?: boolean;
  clf_export_enabled?: boolean;
  reviewed?: boolean;
  flagged?: boolean;
  next_train?: boolean;
};

export type ImagePoolUiSession = {
  filter: ImagePoolFilter;
  junkScope: JunkScope;
  hideJunk: HideJunkMode;
  scrollTop: number;
  viewportImagePath: string;
};

export type DuplicateGroup = {
  filenames: string[];
  inMetadata?: string[];
  count: number;
  size: number;
};

export type DuplicateScan = {
  ok?: boolean;
  totalImages?: number;
  groupCount?: number;
  duplicateFiles?: number;
  groups?: DuplicateGroup[];
};

export type FilteredItem = ImagePoolItem & { imagePath: string };
