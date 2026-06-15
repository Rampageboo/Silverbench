import { useCallback, useContext, useEffect, useState } from "react";
import * as api from "../../api";
import { ImagePoolBadgeContext } from "./imagePoolBadgeContext";

export function useImagePoolBadge() {
  const context = useContext(ImagePoolBadgeContext);
  if (!context) {
    throw new Error("useImagePoolBadge must be used within ImagePoolBadgeProvider.");
  }
  return context;
}

export function useImagePoolBadgeState(workspaceRoot: string) {
  const [imagePoolNewCount, setImagePoolNewCount] = useState(0);

  const refreshImagePoolBadge = useCallback(
    async (rootOverride?: string) => {
      const root = (rootOverride ?? workspaceRoot).trim();
      if (!root) {
        setImagePoolNewCount(0);
        return;
      }
      try {
        const result = await api.scanImagePool(root, { fast: true });
        setImagePoolNewCount(result.newCount ?? 0);
      } catch {
        // Badge refresh is best-effort.
      }
    },
    [workspaceRoot]
  );

  useEffect(() => {
    void refreshImagePoolBadge();
  }, [refreshImagePoolBadge]);

  return {
    imagePoolNewCount,
    setImagePoolNewCount,
    refreshImagePoolBadge
  };
}
