/** Primary navigation tabs visible in the redesigned sidebar. */
export type PrimaryTab = "home" | "gallery" | "library" | "classes" | "label" | "orchestrate";

/** Legacy tool tabs kept alive for KeepAlive rendering; not shown directly in nav. */
export type LegacyToolTab =
  | "image-pool"
  | "video-capture"
  | "train-prep"
  | "train"
  | "crop"
  | "mask-noise"
  | "merge";

/** Union of all addressable tabs. */
export type ToolTab = PrimaryTab | LegacyToolTab;

export type WorkbenchToolGroup = "primary" | "video" | "image" | "dataset" | "utility";

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
  /** If true, visible in the primary sidebar navigation. */
  navPrimary?: boolean;
};

/**
 * Primary navigation items shown in the sidebar.
 */
export const PRIMARY_NAV_TOOLS: readonly WorkbenchTool[] = [
  {
    tab: "home",
    label: "Start",
    labelZh: "开始",
    keywords: "home start welcome workspace create open recent",
    group: "primary",
    keepAlive: false,
    navPrimary: true
  },
  {
    tab: "gallery",
    label: "Gallery",
    labelZh: "图库与提示词",
    keywords: "gallery prompts noobai anima tagger lora export library 图库 提示词",
    group: "primary",
    keepAlive: true,
    heavy: true,
    requiresWorkspace: false,
    navPrimary: true
  },
  {
    tab: "library",
    label: "Overview",
    labelZh: "概览",
    keywords: "overview library workspace versions snapshot",
    group: "primary",
    keepAlive: false,
    requiresWorkspace: true,
    navPrimary: true
  },
  {
    tab: "classes",
    label: "Classes",
    labelZh: "类别",
    keywords: "classes taxonomy detect classify rename archive",
    group: "primary",
    keepAlive: false,
    requiresWorkspace: true,
    navPrimary: true
  },
  {
    tab: "label",
    label: "Label",
    labelZh: "标注",
    keywords: "label annotate box video image detection",
    group: "primary",
    keepAlive: true,
    heavy: true,
    requiresWorkspace: true,
    primary: true,
    navPrimary: true
  },
  {
    tab: "orchestrate",
    label: "Orchestrator",
    labelZh: "编排",
    keywords: "orchestrate ui map page element automation author editor",
    group: "primary",
    keepAlive: true,
    heavy: true,
    requiresWorkspace: true,
    navPrimary: true
  }
] as const;

/**
 * Legacy tool definitions — kept alive for KeepAlive panels, not shown in primary nav.
 */
export const WORKBENCH_TOOLS: readonly WorkbenchTool[] = [
  {
    tab: "video-capture",
    label: "Video Segments",
    labelZh: "视频片段",
    keywords: "video segment capture screenshot frame export",
    group: "video",
    keepAlive: true,
    heavy: true,
    requiresWorkspace: true
  },
  {
    tab: "image-pool",
    label: "Image Pool",
    labelZh: "图片库",
    keywords: "pool image media image_pool",
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

/** All tools combined — primary nav + legacy tools. */
export const ALL_TOOLS: readonly WorkbenchTool[] = [...PRIMARY_NAV_TOOLS, ...WORKBENCH_TOOLS] as const;
