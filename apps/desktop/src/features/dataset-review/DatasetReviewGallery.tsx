import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ClassifierImageResult } from "../../api";
import { assignVisualState, thumbMediaClasses } from "../image-pool/metadata";
import type { JunkScope, MetadataRow } from "../image-pool/types";
import { computeVirtualGridLayout } from "../image-pool/virtualGrid";
import { datasetImageUrl } from "./datasetAssets";
import type { DatasetPair } from "./datasetCore";

type DatasetReviewGalleryProps = {
  datasetRoot: string;
  pairs: DatasetPair[];
  currentIndex: number;
  shiftSelectedPaths: Set<string>;
  reviewedPaths: Set<string>;
  flaggedPaths: Set<string>;
  metadata: Map<string, MetadataRow>;
  junkScope: JunkScope;
  restoreScrollTop: number;
  onSelect: (index: number, options?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void;
  onScrollChange: (scrollTop: number) => void;
  onDoubleClick?: (index: number) => void;
  onContextMenu?: (index: number, event: React.MouseEvent) => void;
  pendingBlackCount?: (imagePath: string) => number;
  classifierResults?: Map<string, ClassifierImageResult>;
};

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
  onDoubleClick,
  onContextMenu,
  pendingBlackCount,
  classifierResults
}: DatasetReviewGalleryProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(() => computeVirtualGridLayout(null, 0, 138, 10, 36, 10 / 16));

  const recompute = () => {
    setLayout(computeVirtualGridLayout(wrapRef.current, pairs.length, 138, 10, 36, 10 / 16));
  };

  useLayoutEffect(() => {
    recompute();
  }, [pairs.length]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => recompute());
    observer.observe(el);
    return () => observer.disconnect();
  }, [pairs.length]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !restoreScrollTop) return;
    requestAnimationFrame(() => {
      if (!wrapRef.current) return;
      wrapRef.current.scrollTop = restoreScrollTop;
      recompute();
    });
  }, [datasetRoot, restoreScrollTop]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || currentIndex < 0 || !pairs.length) return;
    const columns = Math.max(1, layout.columns || 1);
    const rowHeight = Math.max(1, layout.rowHeight || 132);
    const row = Math.floor(currentIndex / columns);
    const rowTop = row * rowHeight;
    const rowBottom = rowTop + rowHeight;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    if (rowTop >= viewTop && rowBottom <= viewBottom) return;
    el.scrollTop = Math.max(0, Math.round(row * rowHeight - el.clientHeight * 0.35));
  }, [currentIndex, pairs.length, layout.columns, layout.rowHeight]);

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
              const pendingCount = pendingBlackCount?.(pair.imagePath) || 0;
              const classifier = classifierResults?.get(pair.imagePath);
              const classifierTag = classifier?.top
                ? `[${classifier.top.name} ${(classifier.top.confidence * 100).toFixed(0)}%] `
                : "";
              const visual = assignVisualState(row, junkScope);
              const mediaClass = thumbMediaClasses(row, junkScope);
              const tags = `${flagged ? "[FLAG] " : ""}${reviewed ? "[OK] " : ""}${pendingCount ? `[PENDING ${pendingCount}] ` : ""}${classifierTag}`;
              return (
                <div
                  key={pair.imagePath}
                  className={`thumb${active ? " active" : ""}${shiftSelected ? " shift-selected" : ""}${reviewed ? " reviewed" : ""}${flagged ? " flagged" : ""}${pendingCount ? " pending" : ""}`}
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
