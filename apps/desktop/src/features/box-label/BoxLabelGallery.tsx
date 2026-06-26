import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { computeVirtualGridLayout, scrollVirtualGridToIndex } from "../image-pool/virtualGrid";
import { isFlaggedFile, isReviewedFile } from "../image-pool/metadata";
import { datasetImageUrl } from "../dataset-review/datasetAssets";
import type { MetadataRow } from "../image-pool/types";
import type { BoxLabelEntry } from "./boxLabelCore";
import { galleryRevealTargetForKey } from "./galleryNavigation";

type BoxLabelGalleryProps = {
  datasetRoot: string;
  entries: BoxLabelEntry[];
  currentIndex: number;
  shiftSelectedBasenames: Set<string>;
  metadata: Map<string, MetadataRow>;
  imageViewMode: "all" | "hideReviewed" | "flagged";
  restoreScrollTop: number | null;
  restoreImagePath: string;
  onSelect: (index: number, options?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void;
  onScrollChange: (scrollTop: number, imagePath: string) => void;
  onViewportRestored: () => void;
  onImageViewModeChange: (mode: "all" | "hideReviewed" | "flagged") => void;
};

const BOX_LABEL_GRID_PARAMS = { columnUnit: 138, gap: 10, rowExtra: 36, aspectRatio: 10 / 16 } as const;

function galleryThumbTags(row: MetadataRow | undefined) {
  const flagged = isFlaggedFile(row);
  const reviewed = isReviewedFile(row);
  return `${flagged ? "[FLAG] " : ""}${reviewed ? "[OK] " : ""}`;
}

function LazyThumb({ datasetRoot, imagePath }: { datasetRoot: string; imagePath: string }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState("");

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !datasetRoot) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          datasetImageUrl(datasetRoot, imagePath)
            .then((url) => {
              if (!cancelled) setSrc(url);
            })
            .catch(() => {});
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(img);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [datasetRoot, imagePath]);

  return (
    <img
      ref={imgRef}
      src={src || undefined}
      data-src-pending={src ? "false" : "true"}
      alt={imagePath}
      loading="lazy"
    />
  );
}

export function BoxLabelGallery({
  datasetRoot,
  entries,
  currentIndex,
  shiftSelectedBasenames,
  metadata,
  imageViewMode,
  restoreScrollTop,
  restoreImagePath,
  onSelect,
  onScrollChange,
  onViewportRestored,
  onImageViewModeChange
}: BoxLabelGalleryProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pendingKeyboardRevealIndexRef = useRef<number | null>(null);
  const [layout, setLayout] = useState(() => computeVirtualGridLayout(null, 0, 138, 10, 36, 10 / 16));

  const recompute = useCallback(() => {
    setLayout(computeVirtualGridLayout(wrapRef.current, entries.length, 138, 10, 36, 10 / 16));
  }, [entries.length]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => recompute());
    observer.observe(el);
    return () => observer.disconnect();
  }, [recompute]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      pendingKeyboardRevealIndexRef.current = galleryRevealTargetForKey(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          targetTagName: target?.tagName,
          targetEditable: target?.isContentEditable
        },
        currentIndex,
        entries.length
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentIndex, entries.length]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || restoreScrollTop === null) return;
    let scrollTop = restoreScrollTop;
    if (restoreImagePath) {
      const index = entries.findIndex((item) => item.imagePath === restoreImagePath);
      if (index >= 0) {
        const columns = Math.max(1, layout.columns || 1);
        const rowHeight = Math.max(1, layout.rowHeight || 132);
        scrollTop = Math.floor(index / columns) * rowHeight;
      }
    }
    requestAnimationFrame(() => {
      if (!wrapRef.current) return;
      wrapRef.current.scrollTop = scrollTop;
      recompute();
      onViewportRestored();
    });
  }, [restoreScrollTop, restoreImagePath, entries, layout.columns, layout.rowHeight, onViewportRestored, recompute]);

  useEffect(() => {
    pendingKeyboardRevealIndexRef.current = null;
  }, [datasetRoot, entries.length]);

  useEffect(() => {
    const requestedIndex = pendingKeyboardRevealIndexRef.current;
    if (requestedIndex === null || requestedIndex !== currentIndex) return;
    pendingKeyboardRevealIndexRef.current = null;
    const el = wrapRef.current;
    if (!el || currentIndex < 0 || !entries.length) return;
    const { scrolled, layout: nextLayout } = scrollVirtualGridToIndex(el, currentIndex, entries.length, BOX_LABEL_GRID_PARAMS);
    if (scrolled) setLayout(nextLayout);
  }, [currentIndex, entries.length]);

  const visibleItems = useMemo(
    () => entries.slice(layout.startIndex, layout.endIndex),
    [entries, layout.startIndex, layout.endIndex]
  );

  const viewportPathFromScroll = (scrollTop: number) => {
    const columns = Math.max(1, layout.columns || 1);
    const rowHeight = Math.max(1, layout.rowHeight || 132);
    const row = Math.max(0, Math.floor(scrollTop / rowHeight));
    const index = Math.min(entries.length - 1, row * columns);
    return entries[index]?.imagePath || "";
  };

  if (!datasetRoot.trim()) {
    return (
      <section className="panel" id="imagePanel">
        <div className="panel-header">
          <span>Images</span>
        </div>
        <div className="panel-body" id="galleryScroll">
          <div className="empty">Open a workspace first.</div>
        </div>
      </section>
    );
  }

  if (!entries.length) {
    return (
      <section className="panel" id="imagePanel">
        <div className="panel-header">
          <span>Images</span>
        </div>
        <div className="panel-body" id="galleryScroll">
          <div className="empty">detect_dataset 中没有图片。</div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel" id="imagePanel">
      <div className="panel-header">
        <span>Images</span>
        <div className="image-view-controls">
          <button
            id="showAllImagesBtn"
            type="button"
            className={imageViewMode === "all" ? "active" : ""}
            onClick={() => onImageViewModeChange("all")}
          >
            Show All
          </button>
          <button
            id="hideReviewedImagesBtn"
            type="button"
            className={imageViewMode === "hideReviewed" ? "active" : ""}
            onClick={() => onImageViewModeChange("hideReviewed")}
          >
            Hide Reviewed
          </button>
          <button
            id="showFlaggedImagesBtn"
            type="button"
            className={imageViewMode === "flagged" ? "active" : ""}
            onClick={() => onImageViewModeChange("flagged")}
          >
            Show Flagged
          </button>
          <span id="imageCount" className="status">
            {currentIndex + 1} / {entries.length}
          </span>
        </div>
      </div>
      <div
        className="panel-body"
        id="galleryScroll"
        ref={wrapRef}
        onScroll={(event) => {
          const scrollTop = event.currentTarget.scrollTop;
          recompute();
          onScrollChange(scrollTop, viewportPathFromScroll(scrollTop));
        }}
      >
        <div
          className="gallery"
          style={{
            height: `${layout.totalRows * layout.rowHeight}px`,
            ["--gallery-columns" as string]: layout.columns
          }}
        >
          <div
            className="gallery-window"
            style={{ transform: `translateY(${layout.startRow * layout.rowHeight}px)` }}
          >
            {visibleItems.map((item, offset) => {
              const index = layout.startIndex + offset;
              const active = index === currentIndex;
              const shiftSelected = shiftSelectedBasenames.has(item.basename);
              const row = metadata.get(item.basename);
              const reviewed = isReviewedFile(row);
              const flagged = isFlaggedFile(row);
              return (
                <div
                  key={item.imagePath}
                  className={`thumb${active ? " active" : ""}${shiftSelected ? " shift-selected" : ""}${reviewed ? " reviewed" : ""}${flagged ? " flagged" : ""}`}
                  onClick={(event) => {
                    pendingKeyboardRevealIndexRef.current = null;
                    onSelect(index, {
                      shiftKey: event.shiftKey,
                      ctrlKey: event.ctrlKey,
                      metaKey: event.metaKey
                    });
                  }}
                  title={item.basename}
                >
                  <LazyThumb datasetRoot={datasetRoot} imagePath={item.imagePath} />
                  <div className="name">{`${galleryThumbTags(row)}${item.basename}`}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
