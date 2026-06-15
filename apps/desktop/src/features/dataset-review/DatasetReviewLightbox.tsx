import { useCallback, useEffect, useRef, useState } from "react";
import { datasetImageUrl } from "./datasetAssets";
import type { DatasetPair } from "./datasetCore";

type DatasetReviewLightboxProps = {
  open: boolean;
  datasetRoot: string;
  pairs: DatasetPair[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
};

export function DatasetReviewLightbox({
  open,
  datasetRoot,
  pairs,
  index,
  onClose,
  onIndexChange
}: DatasetReviewLightboxProps) {
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
  const pair = pairs[index];

  const applyTransform = useCallback(() => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage) return;
    const view = viewRef.current;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (!iw || !ih) return;
    const scale = view.fitZoom * view.zoom;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const w = iw * scale;
    const h = ih * scale;
    const x = (sw - w) / 2 + view.panX;
    const y = (sh - h) / 2 + view.panY;
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    img.style.transform = `translate(${x}px, ${y}px)`;
  }, []);

  useEffect(() => {
    if (!open || !pair || !datasetRoot) {
      setPreviewSrc("");
      return;
    }
    let cancelled = false;
    datasetImageUrl(datasetRoot, pair.imagePath)
      .then((url) => {
        if (!cancelled) setPreviewSrc(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [datasetRoot, open, pair]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (index > 0) onIndexChange(index - 1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (index < pairs.length - 1) onIndexChange(index + 1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, onClose, onIndexChange, open, pairs.length]);

  useEffect(() => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!open || !img || !stage) return;
    function onLoad() {
      const iw = img!.naturalWidth;
      const ih = img!.naturalHeight;
      const sw = stage!.clientWidth;
      const sh = stage!.clientHeight;
      viewRef.current = {
        zoom: 1,
        panX: 0,
        panY: 0,
        fitZoom: sw && sh && iw && ih ? Math.min(sw / iw, sh / ih) : 1,
        dragging: false,
        dragStartX: 0,
        dragStartY: 0,
        panStartX: 0,
        panStartY: 0
      };
      applyTransform();
    }
    img.addEventListener("load", onLoad);
    if (img.complete) onLoad();
    return () => img.removeEventListener("load", onLoad);
  }, [applyTransform, open, previewSrc]);

  if (!open || !pair) return null;

  return (
    <div className="react-image-pool-preview image-preview-lightbox" role="dialog" aria-modal="true" aria-label="Image preview">
      <div className="image-preview-backdrop" onClick={onClose} />
      <div className="image-preview-shell">
        <div className="image-preview-topbar">
          <span className="image-preview-title">{pair.imagePath.split("/").pop()}</span>
          <span className="image-preview-meta">
            {index + 1} / {pairs.length}
          </span>
          <button type="button" className="image-preview-close" onClick={onClose} aria-label="Close preview">
            ×
          </button>
        </div>
        <div
          className="image-preview-stage"
          ref={stageRef}
          onWheel={(event) => {
            event.preventDefault();
            const factor = event.deltaY < 0 ? 1.1 : 0.9;
            viewRef.current.zoom = Math.max(0.2, Math.min(8, viewRef.current.zoom * factor));
            applyTransform();
          }}
          onPointerDown={(event) => {
            viewRef.current.dragging = true;
            viewRef.current.dragStartX = event.clientX;
            viewRef.current.dragStartY = event.clientY;
            viewRef.current.panStartX = viewRef.current.panX;
            viewRef.current.panStartY = viewRef.current.panY;
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!viewRef.current.dragging) return;
            viewRef.current.panX = viewRef.current.panStartX + (event.clientX - viewRef.current.dragStartX);
            viewRef.current.panY = viewRef.current.panStartY + (event.clientY - viewRef.current.dragStartY);
            applyTransform();
          }}
          onPointerUp={(event) => {
            viewRef.current.dragging = false;
            try {
              (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
            } catch {
              /* ignore */
            }
          }}
        >
          {previewSrc ? (
            <img ref={imgRef} src={previewSrc} alt={pair.imagePath} className="image-preview-img" draggable={false} />
          ) : (
            <div className="empty">Loading preview...</div>
          )}
        </div>
        <div className="image-preview-footer row">
          <button type="button" disabled={index <= 0} onClick={() => onIndexChange(index - 1)}>
            Prev
          </button>
          <button type="button" disabled={index >= pairs.length - 1} onClick={() => onIndexChange(index + 1)}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
