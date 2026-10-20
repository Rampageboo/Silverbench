import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { assignVisualState, thumbMediaClasses } from "../image-pool/metadata";
import type { JunkScope, MetadataRow } from "../image-pool/types";
import { computeVirtualGridLayout, sameVirtualGridLayout, scrollVirtualGridToIndex } from "../image-pool/virtualGrid";
import { datasetImageUrl } from "./datasetAssets";
import type { DatasetPair } from "./datasetCore";
import "./datasetReview.css";

type DatasetReviewGalleryProps = {
  datasetRoot: string;
  pairs: DatasetPair[];
  currentIndex: number;
  shiftSelectedPaths: Set<string>;
  reviewedPaths: Set<string>;
  flaggedPaths: Set<string>;
  metadata: Map<string, MetadataRow>;
  junkScope: JunkScope;
  restoreScrollTop: number | null;
  onSelect: (index: number, options?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void;
  onScrollChange: (scrollTop: number) => void;
  onViewportRestored?: () => void;
  onDoubleClick?: (index: number) => void;
  onContextMenu?: (index: number, event: React.MouseEvent) => void;
};

const DATASET_REVIEW_GRID_PARAMS = { columnUnit: 138, gap: 10, rowExtra: 36, aspectRatio: 10 / 16 } as const;

function LazyDatasetThumb({ datasetRoot, imagePath }: { datasetRoot: string; imagePath: string }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState("");

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !datasetRoot) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          datasetImageUrl(datasetRoot, imagePath)
            .then((url) => setSrc(url))
            .catch(() => {});
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(img);
    return () => observer.disconnect();
  }, [datasetRoot, imagePath]);

  return (
    <img
      ref={imgRef}
      src={src || undefined}
      data-path={imagePath}
      data-src-pending={src ? "false" : "true"}
      alt={imagePath.split("/").pop() || imagePath}
      loading="lazy"
    />
  );
}

export function DatasetReviewGallery({
  datasetRoot,
  pairs,
  currentIndex,
  shiftSelectedPaths,
  reviewedPaths,
  flaggedPaths,
  metadata,
  junkScope,
  restoreScrollTop,
  onSelect,
  onScrollChange,
  onViewportRestored,
  onDoubleClick,
  onContextMenu
}: DatasetReviewGalleryProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastScrolledIndexRef = useRef(-1);
  const [layout, setLayout] = useState(() => computeVirtualGridLayout(null, 0, 138, 10, 36, 10 / 16));

  const recompute = useCallback(() => {
    const next = computeVirtualGridLayout(wrapRef.current, pairs.length, 138, 10, 36, 10 / 16);
    setLayout((prev) => (sameVirtualGridLayout(prev, next) ? prev : next));
  }, [pairs.length]);

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
    lastScrolledIndexRef.current = -1;
  }, [datasetRoot, pairs.length]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || restoreScrollTop === null) return;
    requestAnimationFrame(() => {
      if (!wrapRef.current) return;
      wrapRef.current.scrollTop = restoreScrollTop;
      recompute();
      onViewportRestored?.();
    });
  }, [datasetRoot, restoreScrollTop, onViewportRestored, recompute]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || currentIndex < 0 || !pairs.length || currentIndex === lastScrolledIndexRef.current) return;
    const { scrolled, layout: nextLayout } = scrollVirtualGridToIndex(el, currentIndex, pairs.length, DATASET_REVIEW_GRID_PARAMS);
    lastScrolledIndexRef.current = currentIndex;
    if (scrolled) setLayout((prev) => (sameVirtualGridLayout(prev, nextLayout) ? prev : nextLayout));
  }, [currentIndex, pairs.length]);

  const visibleItems = useMemo(
    () => pairs.slice(layout.startIndex, layout.endIndex),
    [pairs, layout.startIndex, layout.endIndex]
  );

  if (!pairs.length) {
    return (
      <section className="panel" id="imagePanel">
        <div className="panel-header">
          <span>Images</span>
        </div>
        <div className="panel-body" id="galleryScroll">
          <div className="empty">No images match the current filter.</div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel" id="imagePanel">
      <div className="panel-header">
        <span>Images</span>
        <span id="imageCount" className="status">
          {currentIndex + 1} / {pairs.length}
        </span>
      </div>
      <div
        className="panel-body"
        id="galleryScroll"
        ref={wrapRef}
        onScroll={(event) => {
          recompute();
          onScrollChange(event.currentTarget.scrollTop);
        }}
      >
        <div
          className="gallery"
          id="gallery"
          style={{
            height: `${layout.totalRows * layout.rowHeight}px`,
            ["--gallery-columns" as string]: layout.columns
          }}
        >
          <div
            className="gallery-window"
            style={{ transform: `translateY(${layout.startRow * layout.rowHeight}px)` }}
          >
            {visibleItems.map((pair, offset) => {
              const index = layout.startIndex + offset;
              const filename = pair.imagePath.split("/").pop() || pair.imagePath;
              const row = metadata.get(filename);
              const active = index === currentIndex;
              const shiftSelected = shiftSelectedPaths.has(pair.imagePath);
              const reviewed = reviewedPaths.has(pair.imagePath);
              const flagged = flaggedPaths.has(pair.imagePath);
              const visual = assignVisualState(row, junkScope);
              const mediaClass = thumbMediaClasses(row, junkScope);
              const tags = `${flagged ? "[FLAG] " : ""}${reviewed ? "[OK] " : ""}`;
              return (
                <div
                  key={pair.imagePath}
                  className={`thumb${active ? " active" : ""}${shiftSelected ? " shift-selected" : ""}${reviewed ? " reviewed" : ""}${flagged ? " flagged" : ""}`}
                  onClick={(event) =>
                    onSelect(index, {
                      shiftKey: event.shiftKey,
                      ctrlKey: event.ctrlKey,
                      metaKey: event.metaKey
                    })
                  }
                  onDoubleClick={() => onDoubleClick?.(index)}
                  onContextMenu={(event) => onContextMenu?.(index, event)}
                >
                  <div className={`inbox-thumb-media${mediaClass ? ` ${mediaClass}` : ""}`}>
                    <LazyDatasetThumb datasetRoot={datasetRoot} imagePath={pair.imagePath} />
                    {visual.overlay ? (
                      <div
                        className={`inbox-assign-overlay ${visual.overlay === "junk" ? "is-junk" : "is-active"}`}
                        aria-hidden="true"
                      >
                        {visual.overlay === "junk" ? "✕" : "✓"}
                      </div>
                    ) : null}
                  </div>
                  <div className="name">{`${tags}${filename}`}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
