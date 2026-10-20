export type ImageWorkspaceTab = "image-pool" | "inbox" | "yolo";

export function normalizeImageWorkspaceTab(tab: string): ImageWorkspaceTab {
  if (tab === "inbox") return "inbox";
  if (tab === "yolo") return "yolo";
  return "image-pool";
}

