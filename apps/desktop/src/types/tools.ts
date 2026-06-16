export type ToolTab =
  | "image-pool"
  | "pool-label"
  | "video"
  | "train-prep"
  | "train"
  | "crop"
  | "mask-noise"
  | "merge";

export type ToolSurface = "react" | "legacy";

export type WorkbenchTool = {
  tab: ToolTab;
  label: string;
  labelZh: string;
  keywords: string;
  surface: ToolSurface;
};

export const WORKBENCH_TOOLS: WorkbenchTool[] = [
  { tab: "image-pool", label: "Image Pool", labelZh: "Image Pool", keywords: "pool image image_pool", surface: "react" },
  { tab: "pool-label", label: "Box Label", labelZh: "Box Label", keywords: "label box detection annotation track", surface: "react" },
  { tab: "video", label: "Video Capture", labelZh: "Video Capture", keywords: "video capture screenshot", surface: "legacy" },
  { tab: "train-prep", label: "Dataset Prep", labelZh: "Dataset Prep", keywords: "prep split yaml train val", surface: "react" },
  { tab: "train", label: "Auto Label", labelZh: "Auto Label", keywords: "auto train pt model", surface: "react" },
  { tab: "crop", label: "Batch Crop", labelZh: "Batch Crop", keywords: "crop batch", surface: "react" },
  { tab: "mask-noise", label: "Mask Cleanup", labelZh: "Mask Cleanup", keywords: "mask noise cleanup", surface: "legacy" },
  { tab: "merge", label: "Dataset Merge", labelZh: "Dataset Merge", keywords: "merge zip dataset", surface: "react" }
];

export function getToolSurface(tab: ToolTab): ToolSurface {
  return WORKBENCH_TOOLS.find((tool) => tool.tab === tab)?.surface ?? "legacy";
}

export const NATIVE_REACT_TABS = new Set<ToolTab>(["image-pool", "pool-label", "train-prep", "train", "crop", "merge"]);

export function tabUsesNativeReact(tab: ToolTab): boolean {
  return getToolSurface(tab) === "react" && NATIVE_REACT_TABS.has(tab);
}

export function imageWorkspaceTabUsesNativeReact(): boolean {
  return true;
}

export function tabUsesLegacyEngine(tab: ToolTab): boolean {
  return getToolSurface(tab) === "react" && !NATIVE_REACT_TABS.has(tab);
}

export function usesEmbeddedToolChrome(tab: ToolTab): boolean {
  return getToolSurface(tab) === "legacy" || tabUsesLegacyEngine(tab);
}
