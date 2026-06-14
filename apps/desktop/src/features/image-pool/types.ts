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
  detect_junk?: boolean | string;
  clf_class?: string;
  detect_enabled?: boolean | string;
  clf_enabled?: boolean | string;
  reviewed?: boolean | string;
  flagged?: boolean | string;
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
