import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { ImageWorkspaceTab } from "../features/image-pool/imageWorkspaceMode";
import { WORKBENCH_TOOLS, type ToolTab, type WorkbenchTool } from "../types/tools";

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
  video: VideoLabelTool,
  "pool-label": ImageBoxLabelTool,
  "image-pool": ImageWorkspaceTool,
  "train-prep": TrainPrepTool,
  train: AutoLabelTool,
  crop: CropTool,
  "mask-noise": MaskCleanupTool,
  merge: MergeTool
};

/** Runtime registry: one ordered definition list drives navigation and rendering. */
export const WORKBENCH_TOOL_DEFINITIONS: readonly WorkbenchToolDefinition[] = WORKBENCH_TOOLS.map((tool) => ({
  ...tool,
  component: TOOL_COMPONENTS[tool.tab]
}));

export function workbenchTool(tab: ToolTab) {
  return WORKBENCH_TOOL_DEFINITIONS.find((tool) => tool.tab === tab) || null;
}
