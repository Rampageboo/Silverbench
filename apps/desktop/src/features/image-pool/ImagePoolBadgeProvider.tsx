import type { ReactNode } from "react";
import { ImagePoolBadgeContext } from "./imagePoolBadgeContext";
import { useImagePoolBadgeState } from "./useImagePoolBadge";

type ImagePoolBadgeProviderProps = {
  workspaceRoot: string;
  children: ReactNode;
};

export function ImagePoolBadgeProvider({ workspaceRoot, children }: ImagePoolBadgeProviderProps) {
  const value = useImagePoolBadgeState(workspaceRoot);
  return <ImagePoolBadgeContext.Provider value={value}>{children}</ImagePoolBadgeContext.Provider>;
}
