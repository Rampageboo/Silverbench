import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as api from "../../api";
import { assignVisualState, thumbMediaClasses } from "../image-pool/metadata";
import type { JunkScope, MetadataRow } from "../image-pool/types";
import { computeVirtualGridLayout, sameVirtualGridLayout } from "../image-pool/virtualGrid";
import { inboxClassTagForFile } from "./helpers";
import type { InboxItem } from "./types";
import "./inbox.css";

type ImageAssignGridProps = {
  workspaceRoot: string;
  items: InboxItem[];
  metadata: Map<string, MetadataRow>;
  junkScope: JunkScope;
  selected: Set<string>;
  pendingFilenames: Set<string>;
  restoreScrollTop?: number | null;
  onSelect: (index: number, options?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void;
  onDoubleClick: (index: number) => void;
  onScrollChange?: (scrollTop: number) => void;
  onViewportRestored?: () => void;
};

function LazyThumb({ workspaceRoot, filename }: { workspaceRoot: string; filename: string }) {
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
      alt={filename}
      loading="lazy"
    />
  );
}

export function ImageAssignGrid({
  workspaceRoot,
  items,
  metadata,
  junkScope,
  selected,
  pendingFilenames,
  restoreScrollTop = null,
  onSelect,
  onDoubleClick,
  onScrollChange,
  onViewportRestored
}: ImageAssignGridProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(() => computeVirtualGridLayout(null, 0, 148, 10, 58, 1));

  const recompute = useCallback(() => {
    const next = computeVirtualGridLayout(wrapRef.current, items.length, 148, 10, 58, 1);
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
    requestAnimationFrame(() => {
      if (!wrapRef.current) return;
      wrapRef.current.scrollTop = restoreScrollTop;
      recompute();
      onViewportRestored?.();
    });
  }, [workspaceRoot, restoreScrollTop, onViewportRestored, recompute]);

  const visibleItems = useMemo(
    () => items.slice(layout.startIndex, layout.endIndex),
    [items, layout.startIndex, layout.endIndex]
  );

  if (!workspaceRoot.trim()) {
    return (
      <div className="inbox-grid-wrap" id="inboxGridWrap">
        <div className="gallery" id="inboxGrid">
          <div className="empty">Open a workspace containing media, then start assigning NEW images.</div>
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="inbox-grid-wrap" id="inboxGridWrap">
        <div className="gallery" id="inboxGrid">
          <div className="empty">No images match the current filter.</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="inbox-grid-wrap"
      id="inboxGridWrap"
      ref={wrapRef}
      onScroll={(event) => {
        recompute();
        onScrollChange?.(event.currentTarget.scrollTop);
      }}
    >
      <div
        className="gallery"
        id="inboxGrid"
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
            const row = metadata.get(item.filename);
            const isSelected = selected.has(item.filename);
            const visual = assignVisualState(row, junkScope);
            const mediaClass = thumbMediaClasses(row, junkScope);
            const classTag = inboxClassTagForFile(item.filename, metadata);
            const pendingBuild = pendingFilenames.has(item.filename);
            return (
              <article
                key={item.filename}
                className={`thumb image-pool-entry inbox-entry${isSelected ? " selected" : ""}`}
                onClick={(event) =>
                  onSelect(index, {
                    shiftKey: event.shiftKey,
                    ctrlKey: event.ctrlKey,
                    metaKey: event.metaKey
                  })
                }
                onDoubleClick={() => onDoubleClick(index)}
              >
                {(item.isNew || pendingBuild) && (
                  <div className="image-pool-badges">
                    {item.isNew ? <span className="image-pool-badge">NEW</span> : null}
                    {pendingBuild ? <span className="image-pool-badge pending-build">PENDING</span> : null}
                  </div>
                )}
                <div className={`inbox-thumb-media${mediaClass ? ` ${mediaClass}` : ""}`}>
                  <LazyThumb workspaceRoot={workspaceRoot} filename={item.filename} />
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
                  <div className="inbox-meta-tag">{classTag}</div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
