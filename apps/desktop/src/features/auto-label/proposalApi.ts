/**
 * Sidecar proposal storage for image-pool Box Label entries.
 *
 * Proposals are stored separately from YOLO .txt label files so they never
 * pollute the training data. Only accepted (materialized) boxes end up in
 * the .txt files that YOLO training reads.
 *
 * Storage path: workspace/proposals/detect/{image-key}.json
 */

import { readTextFile, writeTextFile } from "../../api";
import type { DetectProposal } from "../video/videoAnnotationApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImageProposalManifest = {
  version: 1;
  imageKey: string;
  proposals: DetectProposal[];
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const PROPOSALS_ROOT = "workspace/proposals/detect";

/** Generate a stable, path-safe key for an image path. */
export function imageProposalKey(imagePath: string): string {
  const normalized = imagePath.replace(/\\/g, "/");
  const stem = (normalized.split("/").pop() ?? "image").replace(/\.[^.]+$/, "");
  const safe = stem.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "image";
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${safe}-${(hash >>> 0).toString(16).slice(0, 8)}`;
}

export function imageProposalRelativePath(imageKey: string): string {
  const safeName = imageKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${PROPOSALS_ROOT}/${safeName}.json`;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function emptyProposalManifest(imageKey: string): ImageProposalManifest {
  return { version: 1, imageKey, proposals: [], updatedAt: new Date().toISOString() };
}

function normalizeImageProposalManifest(raw: unknown, imageKey: string): ImageProposalManifest {
  if (!raw || typeof raw !== "object") return emptyProposalManifest(imageKey);
  const src = raw as Record<string, unknown>;
  const proposals = Array.isArray(src.proposals)
    ? (src.proposals as unknown[]).filter(
        (p): p is DetectProposal =>
          !!p &&
          typeof p === "object" &&
          typeof (p as DetectProposal).id === "string" &&
          !!(p as DetectProposal).id
      )
    : [];
  return {
    version: 1,
    imageKey: typeof src.imageKey === "string" ? src.imageKey : imageKey,
    proposals,
    updatedAt: typeof src.updatedAt === "string" ? src.updatedAt : new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

export async function loadImageProposals(
  workspaceRoot: string,
  imageKey: string
): Promise<ImageProposalManifest> {
  const path = imageProposalRelativePath(imageKey);
  try {
    const text = await readTextFile(workspaceRoot, path);
    if (!text.trim()) return emptyProposalManifest(imageKey);
    return normalizeImageProposalManifest(JSON.parse(text), imageKey);
  } catch {
    return emptyProposalManifest(imageKey);
  }
}

export async function saveImageProposals(
  workspaceRoot: string,
  manifest: ImageProposalManifest
): Promise<ImageProposalManifest> {
  const next: ImageProposalManifest = { ...manifest, updatedAt: new Date().toISOString() };
  await writeTextFile(
    workspaceRoot,
    imageProposalRelativePath(manifest.imageKey),
    `${JSON.stringify(next, null, 2)}\n`
  );
  return next;
}

// ---------------------------------------------------------------------------
// Mutations (load → mutate → save)
// ---------------------------------------------------------------------------

export async function addImageProposal(
  workspaceRoot: string,
  imageKey: string,
  proposal: DetectProposal
): Promise<ImageProposalManifest> {
  const manifest = await loadImageProposals(workspaceRoot, imageKey);
  if (manifest.proposals.some((p) => p.id === proposal.id)) return manifest;
  return saveImageProposals(workspaceRoot, {
    ...manifest,
    proposals: [...manifest.proposals, proposal]
  });
}

export async function removeImageProposal(
  workspaceRoot: string,
  imageKey: string,
  proposalId: string
): Promise<ImageProposalManifest> {
  const manifest = await loadImageProposals(workspaceRoot, imageKey);
  return saveImageProposals(workspaceRoot, {
    ...manifest,
    proposals: manifest.proposals.filter((p) => p.id !== proposalId)
  });
}

export async function clearImageProposals(
  workspaceRoot: string,
  imageKey: string
): Promise<ImageProposalManifest> {
  const manifest = await loadImageProposals(workspaceRoot, imageKey);
  return saveImageProposals(workspaceRoot, { ...manifest, proposals: [] });
}
