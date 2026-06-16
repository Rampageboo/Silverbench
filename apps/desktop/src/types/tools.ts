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
  { tab: "image-pool", label: "Image Pool", labelZh: "图片库", keywords: "pool image 素材 图库 image_pool", surface: "react" },
  { tab: "pool-label", label: "Box Label", labelZh: "框标注", keywords: "label box 检测框 标注 track", surface: "react" },
  { tab: "video", label: "Video Capture", labelZh: "视频截帧", keywords: "video capture screenshot 视频 截帧", surface: "legacy" },
  { tab: "train-prep", label: "Dataset Prep", labelZh: "数据集准备", keywords: "prep split yaml train val 准备", surface: "react" },
  { tab: "train", label: "Auto Label", labelZh: "自动标注", keywords: "auto train pt model 自动标注 模型", surface: "legacy" },
  { tab: "crop", label: "Batch Crop", labelZh: "批量裁剪", keywords: "crop batch 裁剪", surface: "legacy" },
  { tab: "mask-noise", label: "Mask Cleanup", labelZh: "掩码清理", keywords: "mask noise cleanup 掩码 清理", surface: "legacy" },
  { tab: "merge", label: "Dataset Merge", labelZh: "数据集合并", keywords: "merge zip 合并 数据集", surface: "legacy" }
];

export function getToolSurface(tab: ToolTab): ToolSurface {
  return WORKBENCH_TOOLS.find((tool) => tool.tab === tab)?.surface ?? "legacy";
}

/**
 * 已完成原生 React 重写的 tab。
 * image-pool 下 inbox/yolo 子模式见 imageWorkspaceUsesNativeReact()。
 */
export const NATIVE_REACT_TABS = new Set<ToolTab>(["image-pool", "pool-label", "train-prep"]);

export function tabUsesNativeReact(tab: ToolTab): boolean {
  return getToolSurface(tab) === "react" && NATIVE_REACT_TABS.has(tab);
}

export function imageWorkspaceTabUsesNativeReact(): boolean {
  return true;
}

/** React 路由下仍嵌入旧版引擎（UI/功能与 web/ 一致）。 */
export function tabUsesLegacyEngine(tab: ToolTab): boolean {
  return getToolSurface(tab) === "react" && !NATIVE_REACT_TABS.has(tab);
}

export function usesEmbeddedToolChrome(tab: ToolTab): boolean {
  return getToolSurface(tab) === "legacy" || tabUsesLegacyEngine(tab);
}
