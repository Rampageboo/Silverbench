export type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  directory: boolean;
};

export function isZipFile(file: File) {
  return /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

export function readFileArrayBuffer(file: File) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error("FileReader failed."));
    reader.onabort = () => reject(new Error("File read was aborted."));
    reader.readAsArrayBuffer(file);
  });
}

function findEndOfCentralDirectory(view: DataView) {
  const min = Math.max(0, view.byteLength - 22 - 65535);
  for (let offset = view.byteLength - 22; offset >= min; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  return -1;
}

export async function readZipEntries(fileOrBuffer: ArrayBuffer, label = "ZIP") {
  const buffer = fileOrBuffer;
  const view = new DataView(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) throw new Error(`Cannot read ZIP directory: ${label}`);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  const decoder = new TextDecoder();
  for (let i = 0; i < totalEntries; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = new Uint8Array(buffer, offset + 46, nameLength);
    const name = decoder.decode(nameBytes);
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset, directory: name.endsWith("/") });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { buffer, entries };
}

export async function zipEntryBlob(buffer: ArrayBuffer, entry: ZipEntry) {
  const view = new DataView(buffer);
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== 0x04034b50) throw new Error(`Bad ZIP entry: ${entry.name}`);
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = new Blob([buffer.slice(dataStart, dataStart + entry.compressedSize)]);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) {
    if (!("DecompressionStream" in window)) throw new Error("This browser cannot decompress ZIP deflate entries.");
    const stream = compressed.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).blob();
  }
  throw new Error(`Unsupported ZIP compression method ${entry.method}: ${entry.name}`);
}

export function cleanZipPath(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.includes("..")) return "";
  return parts.join("/");
}

export type FileSource =
  | { kind: "backend"; root: string; path: string }
  | { kind: "zip"; zipBuffer: ArrayBuffer; entry: ZipEntry }
  | { kind: "text"; text: string };

export async function collectZipSourceFiles(zipBuffer: ArrayBuffer, out: Map<string, FileSource>) {
  const zip = await readZipEntries(zipBuffer);
  for (const entry of zip.entries) {
    if (entry.directory) continue;
    const path = cleanZipPath(entry.name);
    if (!path || path.startsWith("__MACOSX/") || path.endsWith(".DS_Store")) continue;
    out.set(path, { kind: "zip", zipBuffer: zip.buffer, entry });
  }
}

export async function sourceBlob(source: FileSource) {
  if (source.kind === "text") return new Blob([source.text || ""], { type: "text/plain" });
  if (source.kind === "zip") return zipEntryBlob(source.zipBuffer, source.entry);
  const { readFileBase64 } = await import("../../api");
  const base64 = await readFileBase64(source.root, source.path);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes]);
}

export async function sourceText(source: FileSource) {
  return (await sourceBlob(source)).text();
}

export async function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
