/**
 * Video Export Executor
 *
 * Executes export items produced by `planVideoExport`.
 *
 * Core principle: blackout overlays are applied ONLY to the derived export
 * image in memory. Source video files are NEVER modified.
 *
 * Flow for each item:
 *   1. Decode the video frame via backend RPC (read-only — never writes source).
 *   2. If the item carries blackout rects: apply them to an in-memory canvas.
 *   3. Write the (possibly blacked-out) frame to the export image path.
 *   4. For detect items: write the YOLO label file.
 *
 * The source video path is only passed to `getAnnotationFrameBase64` which is
 * a read operation. Only `imageOutputPath` and `labelOutputPath` (both under
 * the export root) are ever written.
 */

import { writeTextFile, writeFileBase64 } from "../../api";
import { getAnnotationFrameBase64 } from "./videoAnnotationApi";
import { encodeImageWithBlackouts, computeExportBlackoutWarnings } from "./videoExportBlackout";
import type { ExportItem, DetectExportItem, ClfExportItem, ExportPlanResult, YoloBox } from "./videoExportPlanner";
import type { ExportBlackoutWarning } from "./videoExportBlackout";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportItemResult = {
  item: ExportItem;
  status: "ok" | "error" | "skipped";
  blackoutsApplied: number;
  blackoutWarnings: ExportBlackoutWarning[];
  error?: string;
};

export type ExportPlanProgress = {
  total: number;
  done: number;
  errors: number;
};

export type ExportPlanExecutionResult = {
  results: ExportItemResult[];
  total: number;
  succeeded: number;
  failed: number;
  blackoutsApplied: number;
  warnings: ExportBlackoutWarning[];
};

export type ExecuteExportOptions = {
  /** Called after each item completes (ok or error). */
  onProgress?: (progress: ExportPlanProgress, result: ExportItemResult) => void;
  /** JPEG quality for export images. Default: 0.92. */
  jpegQuality?: number;
};

// ---------------------------------------------------------------------------
// YOLO label formatting
// ---------------------------------------------------------------------------

function formatYoloLabel(boxes: YoloBox[]): string {
  if (boxes.length === 0) return "";
  return boxes.map((b) => `${b.classId} ${b.x} ${b.y} ${b.w} ${b.h}`).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Single-item execution
// ---------------------------------------------------------------------------

/**
 * Execute one export item.
 *
 * Reads the video frame (read-only), applies blackouts in memory,
 * writes only to the export paths. Never touches the source video.
 */
export async function executeExportItem(
  workspaceRoot: string,
  item: ExportItem,
  options: ExecuteExportOptions = {}
): Promise<ExportItemResult> {
  const { jpegQuality = 0.92 } = options;
  const { blackouts, videoPath, timestampMs } = item;
  const seconds = timestampMs / 1000;

  // Step 1 — decode source frame (read-only)
  let rawBase64: string;
  try {
    rawBase64 = await getAnnotationFrameBase64(videoPath, seconds);
  } catch (err) {
    return {
      item,
      status: "error",
      blackoutsApplied: 0,
      blackoutWarnings: [],
      error: `Frame decode failed at ${seconds}s: ${String(err)}`,
    };
  }

  // Step 2 — compute overlap warnings (detect items only)
  const blackoutWarnings: ExportBlackoutWarning[] =
    item.task === "detect" && blackouts.length > 0
      ? computeExportBlackoutWarnings(blackouts, item.yoloBoxes)
      : [];

  if (blackoutWarnings.length > 0) {
    console.warn(
      `[export] ${blackoutWarnings.length} blackout/box overlap warning(s) at ${timestampMs}ms in ${videoPath}`
    );
  }

  // Step 3 — apply blackouts in memory (source is never written here)
  let exportBase64: string;
  try {
    exportBase64 = await encodeImageWithBlackouts(rawBase64, blackouts, jpegQuality);
  } catch (err) {
    return {
      item,
      status: "error",
      blackoutsApplied: 0,
      blackoutWarnings,
      error: `Blackout encode failed: ${String(err)}`,
    };
  }

  // Step 4 — write export image (goes to export root, not source)
  try {
    await writeFileBase64(workspaceRoot, item.imageOutputPath, exportBase64);
  } catch (err) {
    return {
      item,
      status: "error",
      blackoutsApplied: blackouts.length,
      blackoutWarnings,
      error: `Write export image failed: ${String(err)}`,
    };
  }

  if (blackouts.length > 0) {
    console.info(
      `[export] Applied ${blackouts.length} blackout rect(s) to ${item.imageOutputPath}`
    );
  }

  // Step 5 — write YOLO label file (detect items only)
  if (item.task === "detect") {
    const labelText = formatYoloLabel((item as DetectExportItem).yoloBoxes);
    try {
      await writeTextFile(workspaceRoot, item.labelOutputPath, labelText);
    } catch (err) {
      return {
        item,
        status: "error",
        blackoutsApplied: blackouts.length,
        blackoutWarnings,
        error: `Write label file failed: ${String(err)}`,
      };
    }
  }

  return {
    item,
    status: "ok",
    blackoutsApplied: blackouts.length,
    blackoutWarnings,
  };
}

// ---------------------------------------------------------------------------
// Plan execution
// ---------------------------------------------------------------------------

/**
 * Execute all items in an export plan sequentially.
 *
 * Items are processed one at a time to avoid saturating the backend.
 * Each item error is recorded and execution continues to the next item.
 */
export async function executeExportPlan(
  workspaceRoot: string,
  plan: ExportPlanResult,
  options: ExecuteExportOptions = {}
): Promise<ExportPlanExecutionResult> {
  const { onProgress } = options;
  const results: ExportItemResult[] = [];
  let succeeded = 0;
  let failed = 0;
  let blackoutsApplied = 0;
  const allWarnings: ExportBlackoutWarning[] = [];

  const total = plan.items.length;

  for (const item of plan.items) {
    const result = await executeExportItem(workspaceRoot, item, options);
    results.push(result);

    if (result.status === "ok") {
      succeeded++;
      blackoutsApplied += result.blackoutsApplied;
      allWarnings.push(...result.blackoutWarnings);
    } else {
      failed++;
    }

    if (onProgress) {
      onProgress({ total, done: succeeded + failed, errors: failed }, result);
    }
  }

  return {
    results,
    total,
    succeeded,
    failed,
    blackoutsApplied,
    warnings: allWarnings,
  };
}
