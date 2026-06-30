import * as api from "../../api";

const cache = new Map<string, string>();

function mimeFor(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return "image/jpeg";
}

function base64ToBlob(base64: string, type: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function mimeForPath(path: string) {
  return mimeFor(path);
}

export async function datasetImageUrl(datasetRoot: string, relativePath: string) {
  const key = `${datasetRoot}::${relativePath}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const base64 = await api.readFileBase64(datasetRoot, relativePath);
  const url = URL.createObjectURL(base64ToBlob(base64, mimeFor(relativePath)));
  cache.set(key, url);
  return url;
}

export async function datasetPreviewImageUrl(datasetRoot: string, relativePath: string, maxEdge = 1280, quality = 60) {
  const key = `${datasetRoot}::${relativePath}::preview:${maxEdge}:${quality}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const params = new URLSearchParams({
    workspaceRoot: datasetRoot,
    relativePath,
    maxEdge: String(maxEdge),
    quality: String(quality)
  });
  const response = await fetch(`${api.API_BASE_URL}/api/files/preview?${params.toString()}`, {
    cache: "force-cache"
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const url = URL.createObjectURL(await response.blob());
  cache.set(key, url);
  return url;
}

export function invalidateDatasetImageUrl(datasetRoot: string, relativePath: string) {
  const prefix = `${datasetRoot}::${relativePath}`;
  for (const [key, url] of cache) {
    if (key === prefix || key.startsWith(`${prefix}::preview:`)) {
      URL.revokeObjectURL(url);
      cache.delete(key);
    }
  }
}

export function revokeDatasetImageUrls() {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}
