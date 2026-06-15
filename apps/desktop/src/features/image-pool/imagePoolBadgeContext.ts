import { createContext } from "react";

export type ImagePoolBadgeContextValue = {
  imagePoolNewCount: number;
  setImagePoolNewCount: (count: number) => void;
  refreshImagePoolBadge: (rootOverride?: string) => Promise<void>;
};

export const ImagePoolBadgeContext = createContext<ImagePoolBadgeContextValue | null>(null);
