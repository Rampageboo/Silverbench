import type { LabelMediaSelection } from "./LabelMediaGrid";

export function buildMediaOrder(videoCount: number, imageCount: number): LabelMediaSelection[] {
  return [
    ...Array.from({ length: Math.max(0, videoCount) }, (_, index) => ({ kind: "video" as const, index })),
    ...Array.from({ length: Math.max(0, imageCount) }, (_, index) => ({ kind: "image" as const, index })),
  ];
}

function clampExistingIndex(index: number, count: number) {
  return Math.max(0, Math.min(index, count - 1));
}

export function normalizeMediaSelection({
  selection,
  imageCount,
  videoCount,
  currentImageIndex,
  currentVideoIndex,
}: {
  selection: LabelMediaSelection;
  imageCount: number;
  videoCount: number;
  currentImageIndex: number;
  currentVideoIndex: number;
}): LabelMediaSelection | null {
  if (selection.kind === "image") {
    if (imageCount > 0) {
      const index = clampExistingIndex(selection.index, imageCount);
      return index === selection.index ? null : { kind: "image", index };
    }
    return videoCount > 0 ? { kind: "video", index: clampExistingIndex(currentVideoIndex, videoCount) } : null;
  }

  if (videoCount > 0) {
    const index = clampExistingIndex(selection.index, videoCount);
    return index === selection.index ? null : { kind: "video", index };
  }
  return imageCount > 0 ? { kind: "image", index: clampExistingIndex(currentImageIndex, imageCount) } : null;
}

export function shouldSelectNewlyLoadedVideo({
  previousVideoCount,
  nextVideoCount,
  selection,
}: {
  previousVideoCount: number;
  nextVideoCount: number;
  selection: LabelMediaSelection;
}) {
  return selection.kind === "video" && nextVideoCount > previousVideoCount;
}
