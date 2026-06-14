import type { ReactNode } from "react";

const mountedPanels = new Set<string>();

type KeepAlivePanelProps = {
  panelKey: string;
  active: boolean;
  className?: string;
  children: ReactNode;
};

/** Mount a panel once visited; hide instead of unmounting to preserve state. */
export function KeepAlivePanel({ panelKey, active, className, children }: KeepAlivePanelProps) {
  if (active) mountedPanels.add(panelKey);
  if (!mountedPanels.has(panelKey)) return null;
  const classNames = [className, active ? "" : "workbench-panel--hidden"].filter(Boolean).join(" ");
  return (
    <div className={classNames || undefined} aria-hidden={!active}>
      {children}
    </div>
  );
}
