import { createContext } from "react";
import type { LabelWorkbenchContextValue } from "./labelWorkbenchTypes";

/**
 * Context for the unified Label Workbench.
 * Provided by LabelPage; consumed by child pages (Phase 3B) and header components.
 */
export const LabelWorkbenchContext = createContext<LabelWorkbenchContextValue | null>(null);
