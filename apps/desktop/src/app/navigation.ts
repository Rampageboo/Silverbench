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
  IconMotion,
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
        label: "Gallery",
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
        icon: IconOverview,
        target: { tab: "library" },
        keywords: "overview workspace versions snapshot library 概览"
      },
      {
        id: "classes",
        label: "Classes",
        icon: IconTag,
        target: { tab: "classes" },
        keywords: "classes taxonomy detect classify rename archive 类别"
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
        icon: IconImages,
        target: { tab: "image-pool", imageTab: "image-pool" },
        keywords: "image pool media import duplicates 图片库",
        badge: "image-pool-new"
      },
      {
        id: "video-capture",
        label: "Video capture",
        icon: IconVideo,
        target: { tab: "video-capture" },
        keywords: "video capture screenshot segments export frames 视频截帧"
      },
      {
        id: "mocap",
        label: "Motion capture",
        icon: IconMotion,
        target: { tab: "mocap" },
        keywords: "mocap motion capture animocap pose skeleton bvh vrma 动捕 动作捕捉"
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
        icon: IconBox,
        target: { tab: "label" },
        keywords: "label annotate box video image detection classify 标注"
      },
      {
        id: "auto-label",
        label: "Auto-label",
        icon: IconSparkle,
        target: { tab: "train" },
        keywords: "auto label pt model predict train 自动标注"
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
        icon: IconReview,
        target: { tab: "image-pool", imageTab: "yolo" },
        keywords: "review dataset filter class flag junk 数据集审阅"
      },
      {
        id: "crop",
        label: "Batch crop",
        icon: IconCrop,
        target: { tab: "crop" },
        keywords: "crop batch smart 批量裁剪"
      },
      {
        id: "mask-noise",
        label: "Mask cleanup",
        icon: IconMask,
        target: { tab: "mask-noise" },
        keywords: "mask noise cleanup blackout 掩码清理"
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
        icon: IconPackage,
        target: { tab: "train-prep" },
        keywords: "dataset prep split yaml train val export 数据集准备"
      },
      {
        id: "merge",
        label: "Merge",
        icon: IconMerge,
        target: { tab: "merge" },
        keywords: "merge zip dataset combine 数据集合并"
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
        icon: IconFlow,
        target: { tab: "orchestrate" },
        keywords: "orchestrate ui map page element automation flow temporal 编排"
      }
    ]
  }
];

/** Reachable from the command palette only. */
export const SECONDARY_NAV_ITEMS: NavItem[] = [
  {
    id: "start",
    label: "Start page",
    icon: IconOverview,
    target: { tab: "home" },
    keywords: "home start welcome recent 开始"
  },
  {
    id: "legacy-assign",
    label: "Legacy assign",
    icon: IconInbox,
    target: { tab: "image-pool", imageTab: "inbox" },
    keywords: "inbox assign export dataset 旧版分配"
  }
];

export function isNavItemActive(item: NavItem, activeTab: ToolTab, imageTab: ImageWorkspaceTab): boolean {
  if (item.target.tab !== activeTab) return false;
  return !item.target.imageTab || item.target.imageTab === imageTab;
}
