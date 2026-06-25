export type ToolTab =
  | "image-pool"
  | "pool-label"
  | "video"
  | "train-prep"
  | "train"
  | "crop"
  | "mask-noise"
  | "merge";

export type WorkbenchToolGroup = "video" | "image" | "dataset" | "utility";

export type WorkbenchTool = {
  tab: ToolTab;
  label: string;
  labelZh: string;
  keywords: string;
  group: WorkbenchToolGroup;
  keepAlive: boolean;
  heavy?: boolean;
  requiresWorkspace?: boolean;
  primary?: boolean;
};

/**
 * Product-level tool catalogue. Rendering is attached in app/toolRegistry.tsx,
 * while navigation, session validation, and policy all use this same list.
 */
export const WORKBENCH_TOOLS: readonly WorkbenchTool[] = [
  {
    tab: "video",
    label: "Video Label",
    labelZh: "视频标注",
    keywords: "video label annotation timestamp frame",
    group: "video",
    keepAlive: true,
    heavy: true,
    requiresWorkspace: true,
    primary: true
  },
  {
    tab: "pool-label",
    label: "Image Box Label",
    labelZh: "图片标注",
    keywords: "image label box detection annotation track",
    group: "image",
    keepAlive: true,
    heavy: true,
    requiresWorkspace: true
  },
  {
    tab: "image-pool",
    label: "Image Pool",
    labelZh: "图片库",
    keywords: "pool image image_pool",
    group: "image",
    keepAlive: true,
    heavy: true,
    requiresWorkspace: true
  },
  {
    tab: "train-prep",
    label: "Dataset Prep",
    labelZh: "数据集准备",
    keywords: "prep split yaml train val",
    group: "dataset",
    keepAlive: true,
    requiresWorkspace: true
  },
  {
    tab: "train",
    label: "Auto Label",
    labelZh: "自动标注",
    keywords: "auto train pt model",
    group: "dataset",
    keepAlive: true
  },
  {
    tab: "crop",
    label: "Batch Crop",
    labelZh: "批量裁剪",
    keywords: "crop batch",
    group: "utility",
    keepAlive: true,
    heavy: true
  },
  {
    tab: "mask-noise",
    label: "Mask Cleanup",
    labelZh: "掩码清理",
    keywords: "mask noise cleanup",
    group: "utility",
    keepAlive: false,
    heavy: true
  },
  {
    tab: "merge",
    label: "Dataset Merge",
    labelZh: "数据集合并",
    keywords: "merge zip dataset",
    group: "dataset",
    keepAlive: true,
    heavy: true
  }
] as const;
