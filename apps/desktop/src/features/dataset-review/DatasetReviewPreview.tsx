import { useEffect, useRef, useState } from "react";
import type { LabelBox } from "../../api";
import {
  drawBoxes,
  imageDisplayRect,
  loadCanvasImage,
  resizeCanvasToParent
} from "../box-label/geometry";
import { datasetImageUrl } from "./datasetAssets";
import type { DatasetPair } from "./datasetCore";

type DatasetReviewPreviewProps = {
  datasetRoot: string;
  pair: DatasetPair | null;
  boxes: LabelBox[];
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
};

export function DatasetReviewPreview({
  datasetRoot,
  pair,
  boxes,
  onPrev,
  onNext,
  canPrev,
  canNext
}: DatasetReviewPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !pair || !datasetRoot) return;

    let cancelled = false;
    async function draw() {
      setError("");
      try {
        const url = await datasetImageUrl(datasetRoot, pair!.imagePath);
        const image = await loadCanvasImage(url);
        if (cancelled) return;
        resizeCanvasToParent(canvas);
        const ctx = canvas!.getContext("2d");
        if (!ctx) return;
        const display = imageDisplayRect(canvas!, image, { zoom: 1, panX: 0, panY: 0 });
        ctx.clearRect(0, 0, canvas!.width, canvas!.height);
        ctx.fillStyle = "#0b1220";
        ctx.fillRect(0, 0, canvas!.width, canvas!.height);
        ctx.drawImage(image, display.x, display.y, display.w, display.h);
        drawBoxes(ctx, display, boxes, null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(wrap);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [boxes, datasetRoot, pair]);

  return (
    <section className="panel" id="previewPanel">
      <div className="panel-header">
        <span>Preview</span>
        <span id="boxCount" className="status">
          {boxes.length} box(es)
        </span>
      </div>
      <div className="panel-body viewer" id="previewViewer">
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="canvas-wrap" id="dropZone" ref={wrapRef}>
          <canvas id="previewCanvas" ref={canvasRef} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button type="button" disabled={!canPrev} onClick={onPrev}>
            Prev (A)
          </button>
          <button type="button" disabled={!canNext} onClick={onNext}>
            Next (D)
          </button>
        </div>
        <div className="hint">{pair ? pair.imagePath : "No image selected."}</div>
      </div>
    </section>
  );
}
