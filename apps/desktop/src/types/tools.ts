/** Primary navigation tabs visible in the redesigned sidebar. */
export type PrimaryTab = "home" | "gallery" | "library" | "classes" | "label" | "orchestrate";

/** Tool pages reached from the sidebar groups and the command palette. */
export type ToolPageTab =
  | "image-pool"
  | "video-capture"
  | "mocap"
  | "train-prep"
  | "train"
  | "crop"
  | "mask-noise"
  | "merge";

/** Union of all addressable tabs. */
export type ToolTab = PrimaryTab | ToolPageTab;

export type WorkbenchToolGroup = "primary" | "video" | "image" | "dataset" | "utility";

export type WorkbenchTool = {
  tab: ToolTab;
  label: string;
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
    group: "primary",
    keepAlive: false,
    navPrimary: true
  },
  {
    tab: "gallery",
    label: "Gallery",
    group: "primary",
    keepAlive: true,
    heavy: true,
    requiresWorkspace: false,
    navPrimary: true
  },
  {
    tab: "library",
    label: "Overview",
    group: "primary",
    keepAlive: false,
    requiresWorkspace: true,
    navPrimary: true
  },
  {
    tab: "classes",
    label: "Classes",
    group: "primary",
    keepAlive: false,
    requiresWorkspace: true,
    navPrimary: true
  },
  {
    tab: "label",
    label: "Label",
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
    group: "primary",
    keepAlive: true,
    heavy: true,
    requiresWorkspace: true,
    navPrimary: true
  }
] as const;

/**
 * Tool pages outside the primary navigation.
 */
export const WORKBENCH_TOOLS: readonly WorkbenchTool[] = [
  {
    tab: "video-capture",
    label: "Video Segments",
    group: "video",
    keepAlive: true,
    heavy: true,
    requiresWorkspace: true
  },
  {
    tab: "mocap",
    label: "Motion Capture",
    group: "video",
    keepAlive: true,
    heavy: true,
    requiresWorkspace: true
  },
  {
    tab: "image-pool",
    label: "Image Pool",
    group: "image",
    keepAlive: true,
    heavy: true,
    requiresWorkspace: true
  },
  {
    tab: "train-prep",
    label: "Dataset Prep",
    group: "dataset",
    keepAlive: true,
    requiresWorkspace: true
  },
  {
    tab: "train",
    label: "Auto Label",
    group: "dataset",
    keepAlive: true
  },
  {
    tab: "crop",
    label: "Batch Crop",
    group: "utility",
    keepAlive: true,
    heavy: true
  },
  {
    tab: "mask-noise",
    label: "Mask Cleanup",
    group: "utility",
    keepAlive: false,
    heavy: true
  },
  {
    tab: "merge",
    label: "Dataset Merge",
    group: "dataset",
    keepAlive: true,
    heavy: true
  }
] as const;

/** All tools: primary navigation, then tool pages. */
export const ALL_TOOLS: readonly WorkbenchTool[] = [...PRIMARY_NAV_TOOLS, ...WORKBENCH_TOOLS] as const;
