import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../../api";
import { isJunkFile, junkLabelForFile } from "./metadata";
import type { FilteredItem, JunkScope, MetadataRow } from "./types";

type ImagePoolPreviewProps = {
  open: boolean;
  workspaceRoot: string;
  items: FilteredItem[];
  metadata: Map<string, MetadataRow>;
  junkScope: JunkScope;
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onMarkJunk: (filename: string) => void;
  onClearJunk: (filename: string) => void;
};

function computeFitZoom(img: HTMLImageElement, stage: HTMLElement) {
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!sw || !sh || !iw || !ih) return 1;
  return Math.min(sw / iw, sh / ih);
}

export function ImagePoolPreview({
  open,
  workspaceRoot,
  items,
  metadata,
  junkScope,
  index,
  onClose,
  onIndexChange,
  onMarkJunk,
  onClearJunk
}: ImagePoolPreviewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const viewRef = useRef({
    zoom: 1,
    panX: 0,
    panY: 0,
    fitZoom: 1,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    panStartX: 0,
    panStartY: 0
  });
  const [previewSrc, setPreviewSrc] = useState("");
  const [zoomLabel, setZoomLabel] = useState("Fit");
  const item = items[index];
  const filename = item?.filename || "";
  const row = metadata.get(filename);
  const isJunk = isJunkFile(row, junkScope);
  const junkLabel = junkLabelForFile(row);
  const scopeLabel = junkScope === "detect" ? "Detect" : "Clf";

  const thumbUrl = useMemo(
    () => (workspaceRoot && filename ? api.imagePoolThumbUrl(workspaceRoot, filename) : ""),
    [workspaceRoot, filename]
  );

  const previewUrl = useMemo(
    () => (workspaceRoot && filename ? api.imagePoolPreviewUrl(workspaceRoot, filename) : ""),
    [workspaceRoot, filename]
  );

  const applyTransform = useCallback(() => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage) return;
    const view = viewRef.current;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (!iw || !ih) return;
    const scale = view.fitZoom * view.zoom;
    const w = iw * scale;
    const h = ih * scale;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    img.style.left = `${sw / 2 - w / 2 + view.panX}px`;
    img.style.top = `${sh / 2 - h / 2 + view.panY}px`;
    img.style.transform = "none";
    setZoomLabel(view.zoom === 1 ? "Fit" : `${Math.round(view.zoom * 100)}%`);
  }, []);

  const resetTransform = useCallback(
    (fit = true) => {
      viewRef.current.zoom = 1;
      viewRef.current.panX = 0;
      viewRef.current.panY = 0;
      if (fit) {
        const img = imgRef.current;
        const stage = stageRef.current;
        if (img && stage && img.naturalWidth > 0) {
          viewRef.current.fitZoom = computeFitZoom(img, stage);
        }
      }
      applyTransform();
    },
    [applyTransform]
  );

  useEffect(() => {
    if (!open || !filename) return;
    resetTransform(true);
    setPreviewSrc(thumbUrl);
    const full = new Image();
    full.onload = () => setPreviewSrc(previewUrl);
    full.src = previewUrl;
  }, [open, filename, thumbUrl, previewUrl, resetTransform]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onIndexChange(Math.max(0, index - 1));
      if (event.key === "ArrowRight") onIndexChange(Math.min(items.length - 1, index + 1));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, onIndexChange, index, items.length]);

  useEffect(() => {
    if (!open) return;
    const stageEl = stageRef.current;
    if (!stageEl) return;
    const stageNode: HTMLDivElement = stageEl;

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      viewRef.current.zoom = Math.max(0.2, Math.min(12, viewRef.current.zoom * factor));
      applyTransform();
    }

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      viewRef.current.dragging = true;
      viewRef.current.dragStartX = event.clientX;
      viewRef.current.dragStartY = event.clientY;
      viewRef.current.panStartX = viewRef.current.panX;
      viewRef.current.panStartY = viewRef.current.panY;
      stageNode.setPointerCapture(event.pointerId);
      stageNode.classList.add("dragging");
    }

    function onPointerMove(event: PointerEvent) {
      if (!viewRef.current.dragging) return;
      viewRef.current.panX = viewRef.current.panStartX + (event.clientX - viewRef.current.dragStartX);
      viewRef.current.panY = viewRef.current.panStartY + (event.clientY - viewRef.current.dragStartY);
      applyTransform();
    }

    function endDrag(event: PointerEvent) {
      if (!viewRef.current.dragging) return;
      viewRef.current.dragging = false;
      stageNode.classList.remove("dragging");
      try {
        stageNode.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    }

    function onDblClick(event: MouseEvent) {
      if (event.target !== imgRef.current) return;
      if (viewRef.current.zoom === 1) {
        viewRef.current.zoom = 2;
      } else {
        resetTransform(true);
        return;
      }
      applyTransform();
    }

    stageNode.addEventListener("wheel", onWheel, { passive: false });
    stageNode.addEventListener("pointerdown", onPointerDown);
    stageNode.addEventListener("pointermove", onPointerMove);
    stageNode.addEventListener("pointerup", endDrag);
    stageNode.addEventListener("pointercancel", endDrag);
    stageNode.addEventListener("dblclick", onDblClick);
    return () => {
      stageNode.removeEventListener("wheel", onWheel);
      stageNode.removeEventListener("pointerdown", onPointerDown);
      stageNode.removeEventListener("pointermove", onPointerMove);
      stageNode.removeEventListener("pointerup", endDrag);
      stageNode.removeEventListener("pointercancel", endDrag);
      stageNode.removeEventListener("dblclick", onDblClick);
    };
  }, [open, applyTransform, resetTransform]);

  const onImageLoad = useCallback(() => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage) return;
    viewRef.current.fitZoom = computeFitZoom(img, stage);
    applyTransform();
  }, [applyTransform]);

  if (!open || !item) return null;

  const filmstripStart = Math.max(0, index - 36);
  const filmstripEnd = Math.min(items.length, index + 37);
  const filmstripItems = items.slice(filmstripStart, filmstripEnd);
  const metaParts = [
    item.isNew ? "NEW" : "",
    item.isUsed ? "linked" : "not in detect/clf datasets",
    junkLabel
  ].filter(Boolean);

  return (
    <div className="react-image-pool-preview image-preview-lightbox" role="dialog" aria-modal="true" aria-label="Image preview">
      <div className="react-image-pool-preview-backdrop image-preview-shell" onClick={onClose} />
      <div className="react-image-pool-preview-dialog image-preview-dialog has-filmstrip">
        <header className="react-image-pool-preview-head image-preview-toolbar">
          <div className="image-preview-title">
            <strong>{filename}</strong>
            <span className="status image-preview-meta">
              {index + 1} / {items.length}
              {metaParts.length ? ` · ${metaParts.join(" · ")}` : ""}
            </span>
          </div>
          <div className="react-image-pool-preview-actions image-preview-zoom-controls">
            <button type="button" onClick={() => {
              viewRef.current.zoom = Math.max(0.2, viewRef.current.zoom / 1.25);
              applyTransform();
            }}>
              −
            </button>
            <button type="button" onClick={() => resetTransform(true)}>
              {zoomLabel}
            </button>
            <button type="button" onClick={() => {
              viewRef.current.zoom = Math.min(12, viewRef.current.zoom * 1.25);
              applyTransform();
            }}>
              +
            </button>
            {isJunk ? (
              <button type="button" className="image-preview-junk is-junk" onClick={() => onClearJunk(filename)}>
                Clear {scopeLabel} Junk
              </button>
            ) : (
              <button type="button" className="image-preview-junk danger" onClick={() => onMarkJunk(filename)}>
                Mark {scopeLabel} Junk
              </button>
            )}
            <button type="button" className="react-image-pool-preview-close image-preview-close" onClick={onClose}>
              ×
            </button>
          </div>
        </header>
        <div
          ref={stageRef}
          className="react-image-pool-preview-stage image-preview-stage"
        >
          <button
            type="button"
            className="react-image-pool-preview-nav image-preview-nav prev"
            disabled={index <= 0}
            onClick={() => onIndexChange(index - 1)}
          >
            ‹
          </button>
          {previewSrc ? (
            <img
              ref={imgRef}
              className="image-preview-img active"
              src={previewSrc}
              alt={filename}
              onLoad={onImageLoad}
            />
          ) : null}
          <button
            type="button"
            className="react-image-pool-preview-nav image-preview-nav next"
            disabled={index >= items.length - 1}
            onClick={() => onIndexChange(index + 1)}
          >
            ›
          </button>
        </div>
        <div className="react-image-pool-preview-filmstrip image-preview-filmstrip">
          <div className="image-preview-filmstrip-track">
            {filmstripStart > 0 ? (
              <div className="image-preview-filmstrip-spacer" style={{ flex: `0 0 ${filmstripStart * 72}px` }} />
            ) : null}
            {filmstripItems.map((filmItem, offset) => {
              const filmIndex = filmstripStart + offset;
              const filmRow = metadata.get(filmItem.filename);
              const filmJunk = isJunkFile(filmRow, junkScope);
              return (
                <button
                  key={filmItem.filename}
                  type="button"
                  className={`react-image-pool-preview-thumb image-preview-filmstrip-item${filmIndex === index ? " active" : ""}${filmJunk ? " inbox-junk" : ""}`}
                  onClick={() => onIndexChange(filmIndex)}
                >
                  <img src={api.imagePoolThumbUrl(workspaceRoot, filmItem.filename)} alt={filmItem.filename} />
                  {filmJunk ? (
                    <span className="image-preview-filmstrip-junk" aria-hidden="true">
                      ✕
                    </span>
                  ) : null}
                </button>
              );
            })}
            {filmstripEnd < items.length ? (
              <div
                className="image-preview-filmstrip-spacer"
                style={{ flex: `0 0 ${Math.max(0, items.length - filmstripEnd) * 72}px` }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
