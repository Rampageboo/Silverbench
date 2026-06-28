import { useContext } from "react";
import { LabelWorkbenchContext } from "./LabelWorkbenchContext";
import type { LabelWorkbenchContextValue } from "./labelWorkbenchTypes";

/**
 * Hook for label workbench child pages to access shared workbench state.
 *
 * Returns null when used outside a LabelPage (e.g. legacy standalone rendering).
 * Phase 3B: BoxLabelPage and VideoLabelPage will call reportSourceSummary here.
 */
export function useLabelWorkbench(): LabelWorkbenchContextValue | null {
  return useContext(LabelWorkbenchContext);
}
