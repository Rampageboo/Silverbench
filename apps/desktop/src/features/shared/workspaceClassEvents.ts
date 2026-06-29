export const WORKSPACE_CLASSES_CHANGED_EVENT = "ywb:workspace-classes-changed";

export type WorkspaceClassesChangedDetail = {
  workspaceRoot: string;
};

export function dispatchWorkspaceClassesChanged(workspaceRoot: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<WorkspaceClassesChangedDetail>(WORKSPACE_CLASSES_CHANGED_EVENT, {
      detail: { workspaceRoot }
    })
  );
}

export function isWorkspaceClassesChangedEvent(
  event: Event
): event is CustomEvent<WorkspaceClassesChangedDetail> {
  return typeof (event as CustomEvent<WorkspaceClassesChangedDetail>).detail?.workspaceRoot === "string";
}
