import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { ImageWorkspaceTab } from "../features/image-pool/imageWorkspaceMode";
import { ALL_TOOLS, type ToolTab, type WorkbenchTool } from "../types/tools";

export type ToolPageProps = {
  active: boolean;
  workspaceRoot: string;
  onReady?: () => void;
  imageWorkspaceTab: ImageWorkspaceTab;
  onImageWorkspaceStatus: (text: string) => void;
};

export type WorkbenchToolDefinition = WorkbenchTool & {
  component: LazyExoticComponent<ComponentType<ToolPageProps>>;
};

// ── Primary nav pages ─────────────────────────────────────────────────────────

const HomeTool = lazy(async () => {
  const { HomePage } = await import("../features/home/HomePage");
  return { default: (props: ToolPageProps) => <HomePage onReady={props.onReady} /> };
});

const LibraryTool = lazy(async () => {
  const { LibraryPage } = await import("../features/library/LibraryPage");
  return { default: (props: ToolPageProps) => <LibraryPage active={props.active} onReady={props.onReady} /> };
});

const LabelTool = lazy(async () => {
  const { LabelPage } = await import("../features/label/LabelPage");
  return { default: (props: ToolPageProps) => <LabelPage active={props.active} onReady={props.onReady} /> };
});

const ReviewHubTool = lazy(async () => {
  const { ReviewHubPage } = await import("../features/review-hub/ReviewHubPage");
  return { default: (props: ToolPageProps) => <ReviewHubPage active={props.active} onReady={props.onReady} /> };
});

const ExportHubTool = lazy(async () => {
  const { ExportHubPage } = await import("../features/export-hub/ExportHubPage");
  return { default: (props: ToolPageProps) => <ExportHubPage active={props.active} onReady={props.onReady} /> };
});

const SettingsTool = lazy(async () => {
  const { SettingsPage } = await import("../features/settings/SettingsPage");
  return { default: (props: ToolPageProps) => <SettingsPage active={props.active} onReady={props.onReady} /> };
});

// ── Legacy keep-alive tools ───────────────────────────────────────────────────

const ImageWorkspaceTool = lazy(async () => {
  const module = await import("../features/image-workspace/ImageWorkspaceToolPage");
  return {
    default: (props: ToolPageProps) => (
      <module.ImageWorkspaceToolPage
        active={props.active}
        tab={props.imageWorkspaceTab}
        onReady={props.onReady}
        onStatusText={props.onImageWorkspaceStatus}
      />
    )
  };
});

const VideoLabelTool = lazy(async () => {
  const module = await import("../features/video/VideoLabelPage");
  return {
    default: (props: ToolPageProps) => <module.VideoLabelPage active={props.active} onReady={props.onReady} />
  };
});

const VideoCaptureTool = lazy(async () => {
  const module = await import("../features/video/VideoCapturePage");
  return {
    default: (props: ToolPageProps) => <module.VideoCapturePage active={props.active} onReady={props.onReady} />
  };
});

const ImageBoxLabelTool = lazy(async () => {
  const module = await import("../features/box-label/BoxLabelPage");
  return { default: (props: ToolPageProps) => <module.BoxLabelPage onReady={props.onReady} /> };
});

const TrainPrepTool = lazy(async () => {
  const module = await import("../features/train-prep/TrainPrepPage");
  return { default: (props: ToolPageProps) => <module.TrainPrepPage onReady={props.onReady} /> };
});

const AutoLabelTool = lazy(async () => {
  const module = await import("../features/auto-label/AutoLabelPage");
  return { default: (props: ToolPageProps) => <module.AutoLabelPage onReady={props.onReady} /> };
});

const CropTool = lazy(async () => {
  const module = await import("../features/crop/CropPage");
  return { default: (props: ToolPageProps) => <module.CropPage onReady={props.onReady} /> };
});

const MaskCleanupTool = lazy(async () => {
  const module = await import("../features/mask-noise/MaskNoisePage");
  return { default: (props: ToolPageProps) => <module.MaskNoisePage onReady={props.onReady} /> };
});

const MergeTool = lazy(async () => {
  const module = await import("../features/merge/MergePage");
  return { default: (props: ToolPageProps) => <module.MergePage onReady={props.onReady} /> };
});

const TOOL_COMPONENTS: Record<ToolTab, WorkbenchToolDefinition["component"]> = {
  // Primary nav
  home: HomeTool,
  library: LibraryTool,
  label: LabelTool,
  review: ReviewHubTool,
  export: ExportHubTool,
  settings: SettingsTool,
  // Legacy keep-alive
  video: VideoLabelTool,
  "video-capture": VideoCaptureTool,
  "pool-label": ImageBoxLabelTool,
  "image-pool": ImageWorkspaceTool,
  "train-prep": TrainPrepTool,
  train: AutoLabelTool,
  crop: CropTool,
  "mask-noise": MaskCleanupTool,
  merge: MergeTool
};

/** Runtime registry: one ordered definition list drives navigation and rendering. */
export const WORKBENCH_TOOL_DEFINITIONS: readonly WorkbenchToolDefinition[] = ALL_TOOLS.map((tool) => ({
  ...tool,
  component: TOOL_COMPONENTS[tool.tab]
}));

export function workbenchTool(tab: ToolTab) {
  return WORKBENCH_TOOL_DEFINITIONS.find((tool) => tool.tab === tab) || null;
}
