const PREVIEW_MAX_EDGE = 1280;
const PREVIEW_JPEG_QUALITY = 70;
const THUMB_JPEG_QUALITY = 54;
const THUMB_URL_CACHE_MAX = 220;

const thumbUrlCache = {
  order: [],
  map: new Map()
};

function prefersDataUrls() {
  return location.protocol === "file:";
}

function base64ToBlob(base64, type) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function releaseMediaUrl(url) {
  if (!url || String(url).startsWith("data:")) return;
  URL.revokeObjectURL(url);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Failed to read file as data URL."));
    reader.readAsDataURL(file);
  });
}

async function objectUrlForFile(file) {
  if (!file) return "";
  if (prefersDataUrls()) return fileToDataUrl(file);
  return URL.createObjectURL(file);
}

function base64JpegObjectUrl(base64) {
  if (!base64) return "";
  if (prefersDataUrls()) return `data:image/jpeg;base64,${base64}`;
  return URL.createObjectURL(base64ToBlob(base64, "image/jpeg"));
}

function touchThumbUrlCache(path) {
  const index = thumbUrlCache.order.indexOf(path);
  if (index >= 0) thumbUrlCache.order.splice(index, 1);
  thumbUrlCache.order.push(path);
}

function evictThumbUrlCache() {
  while (thumbUrlCache.order.length > THUMB_URL_CACHE_MAX) {
    const path = thumbUrlCache.order.shift();
    if (!path) break;
    const url = thumbUrlCache.map.get(path);
    if (url) releaseMediaUrl(url);
    thumbUrlCache.map.delete(path);
  }
}

function getCachedObjectUrl(path) {
  return thumbUrlCache.map.get(path) || null;
}

function setCachedObjectUrl(path, url) {
  if (!path || !url) return url;
  const existing = thumbUrlCache.map.get(path);
  if (existing && existing !== url) releaseMediaUrl(existing);
  thumbUrlCache.map.set(path, url);
  touchThumbUrlCache(path);
  evictThumbUrlCache();
  return url;
}

function removeCachedObjectUrl(path) {
  const url = thumbUrlCache.map.get(path);
  if (url) releaseMediaUrl(url);
  thumbUrlCache.map.delete(path);
  const index = thumbUrlCache.order.indexOf(path);
  if (index >= 0) thumbUrlCache.order.splice(index, 1);
}

function clearCachedObjectUrls() {
  for (const url of thumbUrlCache.map.values()) releaseMediaUrl(url);
  thumbUrlCache.map.clear();
  thumbUrlCache.order.length = 0;
}

function backendImageHandle(handle) {
  return handle?.backendRoot && handle?.backendPath ? handle : null;
}

async function previewBitmapForBackendHandle(handle, maxEdge = PREVIEW_MAX_EDGE, quality = PREVIEW_JPEG_QUALITY) {
  const backend = backendImageHandle(handle);
  if (!backend) return null;
  const base64 = await backendCall(
    "readFilePreviewBase64",
    backend.backendRoot,
    backend.backendPath,
    maxEdge,
    quality
  );
  return createImageBitmap(base64ToBlob(base64, "image/jpeg"));
}

async function previewObjectUrlForBackendHandle(handle, maxEdge = PREVIEW_MAX_EDGE, quality = PREVIEW_JPEG_QUALITY) {
  const backend = backendImageHandle(handle);
  if (!backend) return null;
  const base64 = await backendCall(
    "readFilePreviewBase64",
    backend.backendRoot,
    backend.backendPath,
    maxEdge,
    quality
  );
  return base64JpegObjectUrl(base64);
}

async function thumbObjectUrlForImagePool(filename, maxSize = 128, quality = THUMB_JPEG_QUALITY) {
  const base64 = await backendCall("readImagePoolThumb", state.workspaceRoot, filename, maxSize, quality);
  return base64JpegObjectUrl(base64);
}
