export const WORKSPACE_MEDIA_CHANGED_EVENT = "ywb:workspace-media-changed";

export type WorkspaceMediaChangedDetail = {
  workspaceRoot: string;
};

export function dispatchWorkspaceMediaChanged(workspaceRoot: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<WorkspaceMediaChangedDetail>(WORKSPACE_MEDIA_CHANGED_EVENT, {
      detail: { workspaceRoot }
    })
  );
}

export function isWorkspaceMediaChangedEvent(event: Event): event is CustomEvent<WorkspaceMediaChangedDetail> {
  return event instanceof CustomEvent && typeof event.detail?.workspaceRoot === "string";
}

export function isSameWorkspaceRoot(left: string, right: string) {
  const normalize = (value: string) => value.trim().replace(/[\\/]+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}
