export type ImageWorkspaceTab = "image-pool" | "inbox" | "yolo";

export function normalizeImageWorkspaceTab(tab: string): ImageWorkspaceTab {
  if (tab === "inbox") return "inbox";
  if (tab === "yolo") return "yolo";
  return "image-pool";
}

export const NATIVE_IMAGE_WORKSPACE_TABS = new Set<ImageWorkspaceTab>(["image-pool", "inbox", "yolo"]);

export function imageWorkspaceUsesNativeReact(tab: ImageWorkspaceTab): boolean {
  return NATIVE_IMAGE_WORKSPACE_TABS.has(tab);
}

export function imageWorkspaceTitle(tab: ImageWorkspaceTab): string {
  if (tab === "inbox") return "Legacy Assign";
  if (tab === "yolo") return "Dataset Review";
  return "Image Pool";
}

export function imageWorkspaceStatusFallback(tab: ImageWorkspaceTab, workspaceRoot: string): string {
  const hasRoot = Boolean(workspaceRoot.trim());
  if (tab === "inbox") {
    return hasRoot
      ? "Legacy Assign: optional hard-link builder for old dataset workflows."
      : "Open a workspace to use the legacy assignment tool.";
  }
  if (tab === "yolo") {
    return hasRoot
      ? "Dataset Review: browse, filter, and fix labels in detect/clf datasets."
      : "Open a workspace folder to review datasets.";
  }
  return hasRoot
    ? "Workspace bound. Refresh the scan to update the media list."
    : "Open a workspace folder to manage media.";
}
