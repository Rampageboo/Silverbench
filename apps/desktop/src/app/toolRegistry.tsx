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

const UiOrchestratorTool = lazy(async () => {
  const { UiOrchestratorPage } = await import("../features/ui-orchestrator/UiOrchestratorPage");
  return {
    default: (props: ToolPageProps) => (
      <UiOrchestratorPage active={props.active} workspaceRoot={props.workspaceRoot} onReady={props.onReady} />
    )
  };
});

const GalleryTool = lazy(async () => {
  const { GalleryPage } = await import("../features/gallery/GalleryPage");
  return {
    default: (props: ToolPageProps) => <GalleryPage active={props.active} onReady={props.onReady} />
  };
});

const ClassesTool = lazy(async () => {
  const { ClassesPage } = await import("../features/library/ClassesPage");
  return { default: (props: ToolPageProps) => <ClassesPage onReady={props.onReady} /> };
});

// ── Tool pages ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

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

const VideoCaptureTool = lazy(async () => {
  const module = await import("../features/video/VideoCapturePage");
  return {
    default: (props: ToolPageProps) => (
      <module.VideoCapturePage active={props.active} onReady={props.onReady} />
    )
  };
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
  orchestrate: UiOrchestratorTool,
  classes: ClassesTool,
  gallery: GalleryTool,
  // Tool pages
  "video-capture": VideoCaptureTool,
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

