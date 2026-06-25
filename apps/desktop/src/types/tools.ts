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
  { tab: "video", label: "Video Label", labelZh: "视频标注", keywords: "video label annotation timestamp frame" },
  { tab: "pool-label", label: "Image Box Label", labelZh: "图片标注", keywords: "image label box detection annotation track" },
  { tab: "image-pool", label: "Image Pool", labelZh: "图片库", keywords: "pool image image_pool" },
  { tab: "train-prep", label: "Dataset Prep", labelZh: "Dataset Prep", keywords: "prep split yaml train val" },
  { tab: "train", label: "Auto Label", labelZh: "Auto Label", keywords: "auto train pt model" },
  { tab: "crop", label: "Batch Crop", labelZh: "Batch Crop", keywords: "crop batch" },
  { tab: "mask-noise", label: "Mask Cleanup", labelZh: "Mask Cleanup", keywords: "mask noise cleanup" },
  { tab: "merge", label: "Dataset Merge", labelZh: "Dataset Merge", keywords: "merge zip dataset" }
];
