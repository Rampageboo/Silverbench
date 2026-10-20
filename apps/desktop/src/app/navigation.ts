import type { ComponentType, SVGProps } from "react";
import type { ImageWorkspaceTab } from "../features/image-pool/imageWorkspaceMode";
import type { ToolTab } from "../types/tools";
import {
  IconBox,
  IconCrop,
  IconFlow,
  IconGallery,
  IconImages,
  IconInbox,
  IconMask,
  IconMerge,
  IconOverview,
  IconPackage,
  IconReview,
  IconSparkle,
  IconTag,
  IconVideo
} from "../ui/icons";

export type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export type NavTarget = { tab: ToolTab; imageTab?: ImageWorkspaceTab };

export type NavItem = {
  id: string;
  label: string;
  labelZh: string;
  icon: NavIcon;
  target: NavTarget;
  keywords: string;
  /** Shows the image-pool "new" count. */
  badge?: "image-pool-new";
};

export type NavGroup = { id: string; label: string | null; items: NavItem[] };

/**
 * Sidebar structure: tools grouped by pipeline stage, in the order data flows
 * through them. Every tool is one click away; there are no hub pages.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "gallery",
    label: null,
    items: [
      {
        id: "gallery",
        label: "图库与提示词",
        labelZh: "Gallery & prompts — 全局图库，不需要工作区",
        icon: IconGallery,
        target: { tab: "gallery" },
        keywords: "gallery prompts noobai anima tagger lora export 图库 提示词 反推 训练集"
      }
    ]
  },
  {
    id: "workspace",
    label: "Workspace",
    items: [
      {
        id: "overview",
        label: "Overview",
        labelZh: "概览",
        icon: IconOverview,
        target: { tab: "library" },
        keywords: "overview workspace versions snapshot library"
      },
      {
        id: "classes",
        label: "Classes",
        labelZh: "类别",
        icon: IconTag,
        target: { tab: "classes" },
        keywords: "classes taxonomy detect classify rename archive"
      }
    ]
  },
  {
    id: "data",
    label: "Data",
    items: [
      {
        id: "image-pool",
        label: "Image pool",
        labelZh: "图片库",
        icon: IconImages,
        target: { tab: "image-pool", imageTab: "image-pool" },
        keywords: "image pool media import duplicates",
        badge: "image-pool-new"
      },
      {
        id: "video-capture",
        label: "Video capture",
        labelZh: "视频截帧",
        icon: IconVideo,
        target: { tab: "video-capture" },
        keywords: "video capture screenshot segments export frames"
      }
    ]
  },
  {
    id: "annotate",
    label: "Annotate",
    items: [
      {
        id: "label",
        label: "Label",
        labelZh: "标注",
        icon: IconBox,
        target: { tab: "label" },
        keywords: "label annotate box video image detection classify"
      },
      {
        id: "auto-label",
        label: "Auto-label",
        labelZh: "自动标注",
        icon: IconSparkle,
        target: { tab: "train" },
        keywords: "auto label pt model predict train"
      }
    ]
  },
  {
    id: "curate",
    label: "Curate",
    items: [
      {
        id: "dataset-review",
        label: "Dataset review",
        labelZh: "数据集审阅",
        icon: IconReview,
        target: { tab: "image-pool", imageTab: "yolo" },
        keywords: "review dataset filter class flag junk"
      },
      {
        id: "crop",
        label: "Batch crop",
        labelZh: "批量裁剪",
        icon: IconCrop,
        target: { tab: "crop" },
        keywords: "crop batch smart"
      },
      {
        id: "mask-noise",
        label: "Mask cleanup",
        labelZh: "掩码清理",
        icon: IconMask,
        target: { tab: "mask-noise" },
        keywords: "mask noise cleanup blackout"
      }
    ]
  },
  {
    id: "ship",
    label: "Ship",
    items: [
      {
        id: "train-prep",
        label: "Dataset prep",
        labelZh: "数据集准备",
        icon: IconPackage,
        target: { tab: "train-prep" },
        keywords: "dataset prep split yaml train val export"
      },
      {
        id: "merge",
        label: "Merge",
        labelZh: "数据集合并",
        icon: IconMerge,
        target: { tab: "merge" },
        keywords: "merge zip dataset combine"
      }
    ]
  },
  {
    id: "automate",
    label: "Automate",
    items: [
      {
        id: "orchestrate",
        label: "Orchestrator",
        labelZh: "编排",
        icon: IconFlow,
        target: { tab: "orchestrate" },
        keywords: "orchestrate ui map page element automation flow temporal"
      }
    ]
  }
];

/** Reachable from the command palette only. */
export const SECONDARY_NAV_ITEMS: NavItem[] = [
  {
    id: "start",
    label: "Start page",
    labelZh: "开始",
    icon: IconOverview,
    target: { tab: "home" },
    keywords: "home start welcome recent"
  },
  {
    id: "legacy-assign",
    label: "Legacy assign",
    labelZh: "旧版分配",
    icon: IconInbox,
    target: { tab: "image-pool", imageTab: "inbox" },
    keywords: "inbox assign export dataset"
  }
];

export function isNavItemActive(item: NavItem, activeTab: ToolTab, imageTab: ImageWorkspaceTab): boolean {
  if (item.target.tab !== activeTab) return false;
  return !item.target.imageTab || item.target.imageTab === imageTab;
}

