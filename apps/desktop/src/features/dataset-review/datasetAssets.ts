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

export function invalidateDatasetImageUrl(datasetRoot: string, relativePath: string) {
  const key = `${datasetRoot}::${relativePath}`;
  const url = cache.get(key);
  if (url) URL.revokeObjectURL(url);
  cache.delete(key);
}

export function revokeDatasetImageUrls() {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}
