export type ToolTab =
  | "image-pool"
  | "pool-label"
  | "video"
  | "train-prep"
  | "train"
  | "crop"
  | "mask-noise"
  | "merge";

export type WorkbenchTool = {
  tab: ToolTab;
  label: string;
  labelZh: string;
  keywords: string;
};

export const WORKBENCH_TOOLS: WorkbenchTool[] = [
  { tab: "image-pool", label: "Image Pool", labelZh: "Image Pool", keywords: "pool image image_pool" },
  { tab: "pool-label", label: "Box Label", labelZh: "Box Label", keywords: "label box detection annotation track" },
  { tab: "video", label: "Video Capture", labelZh: "Video Capture", keywords: "video capture screenshot" },
  { tab: "train-prep", label: "Dataset Prep", labelZh: "Dataset Prep", keywords: "prep split yaml train val" },
  { tab: "train", label: "Auto Label", labelZh: "Auto Label", keywords: "auto train pt model" },
  { tab: "crop", label: "Batch Crop", labelZh: "Batch Crop", keywords: "crop batch" },
  { tab: "mask-noise", label: "Mask Cleanup", labelZh: "Mask Cleanup", keywords: "mask noise cleanup" },
  { tab: "merge", label: "Dataset Merge", labelZh: "Dataset Merge", keywords: "merge zip dataset" }
];
