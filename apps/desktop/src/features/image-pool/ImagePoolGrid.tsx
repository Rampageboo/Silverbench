import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as api from "../../api";
import { assignVisualState, thumbMediaClasses } from "./metadata";
import type { FilteredItem, JunkScope, MetadataRow } from "./types";
import { computeVirtualGridLayout, sameVirtualGridLayout } from "./virtualGrid";

type ImagePoolGridProps = {
  workspaceRoot: string;
  items: FilteredItem[];
  metadata: Map<string, MetadataRow>;
  junkScope: JunkScope;
  selected: Set<string>;
  restoreScrollTop: number | null;
  restoreImagePath: string;
  emptyMessage?: string;
  cardExtraClasses: (filename: string) => string;
  junkLabelForFile: (filename: string) => string;
  onCardClick: (event: React.MouseEvent, index: number, item: FilteredItem) => void;
  onCardDoubleClick: (index: number, item: FilteredItem) => void;
  onScrollChange: (scrollTop: number, viewportImagePath: string) => void;
  onViewportRestored: () => void;
};

function LazyThumb({
  workspaceRoot,
  filename,
  alt
}: {
  workspaceRoot: string;
  filename: string;
  alt: string;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState("");

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !workspaceRoot) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSrc(api.imagePoolThumbUrl(workspaceRoot, filename));
          observer.disconnect();
        }
      },
      { rootMargin: "240px" }
    );
    observer.observe(img);
    return () => observer.disconnect();
  }, [workspaceRoot, filename]);

  return (
    <img
      ref={imgRef}
      src={src || undefined}
      data-src-pending={src ? "false" : "true"}
      alt={alt}
      loading="lazy"
    />
  );
}

function ImagePoolThumbCard({
  item,
  index,
  isSelected,
  extra,
  mediaClass,
  visual,
  junkLabel,
  usedText,
  workspaceRoot,
  onCardClick,
  onCardDoubleClick
}: {
  item: FilteredItem;
  index: number;
  isSelected: boolean;
  extra: string;
  mediaClass: string;
  visual: ReturnType<typeof assignVisualState>;
  junkLabel: string;
  usedText: string;
  workspaceRoot: string;
  onCardClick: (event: React.MouseEvent, index: number, item: FilteredItem) => void;
  onCardDoubleClick: (index: number, item: FilteredItem) => void;
}) {
  const clickTimerRef = useRef<number | null>(null);
  const statusParts = [usedText, junkLabel].filter(Boolean);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    };
  }, []);

  return (
    <article
      className={`thumb image-pool-entry${isSelected ? " selected" : ""}${extra ? ` ${extra}` : ""}`}
      title={
        statusParts.length
          ? `${statusParts.join(" · ")} · double-click to preview`
          : "Double-click to preview"
      }
      onClick={(event) => {
        if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = window.setTimeout(() => {
          clickTimerRef.current = null;
          onCardClick(event, index, item);
        }, 260);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (clickTimerRef.current) {
          window.clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        onCardDoubleClick(index, item);
      }}
    >
      {(item.isNew || item.isUsed) && (
        <div className="image-pool-badges">
          {item.isNew ? <span className="image-pool-badge">NEW</span> : null}
          {item.isUsed ? <span className="image-pool-badge used">USED</span> : null}
        </div>
      )}
      <div className={`inbox-thumb-media${mediaClass ? ` ${mediaClass}` : ""}`}>
        <LazyThumb workspaceRoot={workspaceRoot} filename={item.filename} alt={item.filename} />
        {visual.overlay ? (
          <div
            className={`inbox-assign-overlay ${visual.overlay === "junk" ? "is-junk" : "is-active"}`}
            aria-hidden="true"
          >
            {visual.overlay === "junk" ? "✕" : "✓"}
          </div>
        ) : null}
      </div>
      <div className="name">
        {item.filename}
        {statusParts.length ? <div className="image-pool-status">{statusParts.join(" · ")}</div> : null}
      </div>
    </article>
  );
}

export function ImagePoolGrid({
  workspaceRoot,
  items,
  metadata,
  junkScope,
  selected,
  restoreScrollTop,
  restoreImagePath,
  emptyMessage = "",
  cardExtraClasses,
  junkLabelForFile,
  onCardClick,
  onCardDoubleClick,
  onScrollChange,
  onViewportRestored
}: ImagePoolGridProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(() => computeVirtualGridLayout(null, 0));

  const recompute = useCallback(() => {
    const next = computeVirtualGridLayout(wrapRef.current, items.length);
    setLayout((prev) => (sameVirtualGridLayout(prev, next) ? prev : next));
  }, [items.length]);

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
    const el = wrapRef.current;
    if (!el || restoreScrollTop === null) return;
    let scrollTop = restoreScrollTop;
    if (restoreImagePath) {
      const index = items.findIndex((item) => item.imagePath === restoreImagePath);
      if (index >= 0) {
        const columns = Math.max(1, layout.columns || 1);
        const rowHeight = Math.max(1, layout.rowHeight || 150);
        scrollTop = Math.floor(index / columns) * rowHeight;
      }
    }
    requestAnimationFrame(() => {
      if (!wrapRef.current) return;
      wrapRef.current.scrollTop = scrollTop;
      recompute();
      onViewportRestored();
    });
  }, [restoreScrollTop, restoreImagePath, items, layout.columns, layout.rowHeight, onViewportRestored, recompute]);

  const visibleItems = useMemo(
    () => items.slice(layout.startIndex, layout.endIndex),
    [items, layout.startIndex, layout.endIndex]
  );

  const viewportPathFromScroll = (scrollTop: number) => {
    const columns = Math.max(1, layout.columns || 1);
    const rowHeight = Math.max(1, layout.rowHeight || 150);
    const row = Math.max(0, Math.floor(scrollTop / rowHeight));
    const index = Math.min(items.length - 1, row * columns);
    return items[index]?.imagePath || "";
  };

  if (!workspaceRoot.trim() || !items.length) {
    return (
      <div className="image-pool-grid-wrap" ref={wrapRef}>
        <div className="gallery">
          <div className="empty">{emptyMessage || "No images to show."}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="image-pool-grid-wrap"
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
          style={{
            transform: `translateY(${layout.startRow * layout.rowHeight}px)`
          }}
        >
          {visibleItems.map((item, offset) => {
            const index = layout.startIndex + offset;
            const row = metadata.get(item.filename);
            const visual = assignVisualState(row, junkScope);
            const junkLabel = junkLabelForFile(item.filename);
            const usedText = item.isUsed ? "linked" : "not in detect/clf datasets";
            const extra = cardExtraClasses(item.filename);
            const mediaClass = thumbMediaClasses(row, junkScope);
            const isSelected = selected.has(item.filename);
            return (
              <ImagePoolThumbCard
                key={item.filename}
                item={item}
                index={index}
                isSelected={isSelected}
                extra={extra}
                mediaClass={mediaClass}
                visual={visual}
                junkLabel={junkLabel}
                usedText={usedText}
                workspaceRoot={workspaceRoot}
                onCardClick={onCardClick}
                onCardDoubleClick={onCardDoubleClick}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
