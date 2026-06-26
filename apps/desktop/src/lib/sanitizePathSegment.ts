const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const INVALID_SEGMENT_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]+/g;

function clean(value: string) {
  return value
    .normalize("NFKC")
    .replace(INVALID_SEGMENT_CHARS, "_")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");
}

export function sanitizePathSegment(value: string, fallback = "item", maxLength = 120) {
  let result = clean(String(value || ""));
  if (!result || result === "." || result === "..") result = clean(fallback) || "item";
  if (WINDOWS_RESERVED.test(result)) result = `_${result}`;
  result = result.slice(0, Math.max(1, maxLength)).replace(/[. ]+$/g, "");
  return result || "item";
}

/** Sanitize one filename while retaining ordinary extension dots. */
export function sanitizeFilename(value: string, fallback = "file", maxLength = 180) {
  const original = String(value || "").replace(/[\\/]+/g, "_");
  const dot = original.lastIndexOf(".");
  const hasExtension = dot > 0 && dot < original.length - 1;
  const rawStem = hasExtension ? original.slice(0, dot) : original;
  const rawExtension = hasExtension ? original.slice(dot + 1) : "";
  const extension = rawExtension.replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 24);
  const reserved = extension ? extension.length + 1 : 0;
  const stem = sanitizePathSegment(rawStem, fallback, Math.max(1, maxLength - reserved));
  return extension ? `${stem}.${extension}` : stem;
}
