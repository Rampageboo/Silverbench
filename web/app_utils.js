function toPosixPath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/([^:])\/{2,}/g, "$1/");
}

function numberInputValue(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function shellArg(value) {
  const text = String(value);
  return /[\s"'&|<>]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

function sanitizeCropFilename(text) {
  return String(text || "image").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, "_").slice(0, 90) || "image";
}

function smallPathHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function canvasBlob(canvas, type) {
  return new Promise(resolve => canvas.toBlob(resolve, type, 0.95));
}

function ext(path) {
  return (path.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
}

function mimeFor(path) {
  const e = ext(path);
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  return "image/png";
}

function fmt(n) {
  return Number(n).toFixed(6);
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function boxesToText(boxes) {
  return boxes.map(box => `${box.classId} ${fmt(box.x)} ${fmt(box.y)} ${fmt(box.w)} ${fmt(box.h)}`).join("\n") + (boxes.length ? "\n" : "");
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
