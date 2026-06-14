import { writeWorkspaceSession } from "../../api";
import { readWorkspaceSessionLite } from "../image-pool/session";

export type YoloViewMode = "detect" | "clf";
export type ImageViewMode = "all" | "hideReviewed" | "flagged";

export type DatasetReviewSession = {
  reviewedPaths: string[];
  flaggedPaths: string[];
  currentImagePath?: string;
  galleryScrollTop?: number;
  yoloViewMode?: YoloViewMode;
  imageViewMode?: ImageViewMode;
  includeClassIds?: number[];
  excludeClassIds?: number[];
};

export async function readDatasetReviewSession(workspaceRoot: string) {
  const session = (await readWorkspaceSessionLite(workspaceRoot)) || {};
  return {
    reviewedPaths: Array.isArray(session.reviewedPaths) ? (session.reviewedPaths as string[]) : [],
    flaggedPaths: Array.isArray(session.flaggedPaths) ? (session.flaggedPaths as string[]) : [],
    currentImagePath: typeof session.currentImagePath === "string" ? session.currentImagePath : "",
    galleryScrollTop: Math.max(0, Math.round(Number(session.galleryScrollTop) || 0)),
    yoloViewMode: session.yoloViewMode === "clf" ? "clf" : "detect",
    imageViewMode: (["all", "hideReviewed", "flagged"].includes(String(session.imageViewMode))
      ? session.imageViewMode
      : "all") as ImageViewMode,
    includeClassIds: Array.isArray(session.yoloIncludeClassIds)
      ? (session.yoloIncludeClassIds as number[]).filter(Number.isFinite)
      : [],
    excludeClassIds: Array.isArray(session.yoloExcludeClassIds)
      ? (session.yoloExcludeClassIds as number[]).filter(Number.isFinite)
      : []
  } as DatasetReviewSession;
}

export async function saveDatasetReviewSession(
  workspaceRoot: string,
  fields: Partial<DatasetReviewSession>
) {
  const existing = (await readWorkspaceSessionLite(workspaceRoot)) || {};
  await writeWorkspaceSession(workspaceRoot, {
    ...existing,
    activeTab: "yolo",
    reviewedPaths: fields.reviewedPaths,
    flaggedPaths: fields.flaggedPaths,
    currentImagePath: fields.currentImagePath,
    galleryScrollTop: fields.galleryScrollTop,
    yoloViewMode: fields.yoloViewMode,
    imageViewMode: fields.imageViewMode,
    yoloIncludeClassIds: fields.includeClassIds,
    yoloExcludeClassIds: fields.excludeClassIds
  });
}
