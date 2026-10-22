import type { BoneSide } from "./mocapDomain";

/** Size a canvas for the device pixel ratio and return a context in CSS pixels. */
export function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

/** Canvas colours from the theme tokens, so drawings follow light/dark mode. */
export function canvasColors(element: Element) {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const side: Record<BoneSide, string> = {
    center: token("--mc-center", "#7aa2ff"),
    left: token("--mc-left", "#4fd1a5"),
    right: token("--mc-right", "#ff9f6b")
  };
  return {
    side,
    ghost: token("--mc-ghost", "rgba(255,255,255,0.7)"),
    inferred: token("--mc-inferred", "#ffb020"),
    selection: token("--mc-selection", "#ffffff"),
    label: token("--mc-label", "#ffffff"),
    labelHalo: token("--mc-label-halo", "rgba(0,0,0,0.75)"),
    grid: token("--mc-grid", "rgba(255,255,255,0.08)"),
    floor: token("--mc-floor", "rgba(255,255,255,0.25)"),
    text: token("--c-text-2", "#cfd6e0"),
    font: token("--font-ui", "system-ui")
  };
}
