/**
 * Sidecar proposal storage for image-pool Box Label entries.
 *
 * Proposals are stored separately from YOLO .txt label files so they never
 * pollute the training data. Only accepted (materialized) boxes end up in
 * the .txt files that YOLO training reads.
 *
 * Storage path: labels/proposals/<image file name>.json
 */

import { readTextFile, writeTextFile } from "../../api";
import { fileName, proposalPath } from "../../workspace/layout";
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

/** Proposals are keyed by the image's file name (media file names are unique in a workspace). */
export function imageProposalKey(imagePath: string): string {
  return fileName(imagePath);
}

export function imageProposalRelativePath(imageKey: string): string {
  return proposalPath(imageKey);
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
    imageKey,
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

