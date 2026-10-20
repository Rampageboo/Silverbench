import { createContext, useContext, useRef, type ReactNode } from "react";
import "./components.css";

const KeepAliveRegistryContext = createContext<Set<string> | null>(null);

type KeepAliveProviderProps = {
  children: ReactNode;
};

/** Scoped panel registry; cleared when the provider unmounts. */
export function KeepAliveProvider({ children }: KeepAliveProviderProps) {
  const mountedPanels = useRef(new Set<string>()).current;
  return <KeepAliveRegistryContext.Provider value={mountedPanels}>{children}</KeepAliveRegistryContext.Provider>;
}

type KeepAlivePanelProps = {
  panelKey: string;
  active: boolean;
  /** When false, unmount the panel whenever it is inactive. Default true. */
  persist?: boolean;
  className?: string;
  children: ReactNode;
};

/** Mount a panel once visited; hide instead of unmounting to preserve state. */
export function KeepAlivePanel({ panelKey, active, persist = true, className, children }: KeepAlivePanelProps) {
  const mountedPanels = useContext(KeepAliveRegistryContext);
  if (!mountedPanels) {
    throw new Error("KeepAlivePanel must be used within KeepAliveProvider.");
  }

  if (!persist) {
    if (!active) return null;
    const classNames = ["workbench-panel", className, "workbench-panel--active"].filter(Boolean).join(" ");
    return (
      <div className={classNames} aria-hidden={false}>
        {children}
      </div>
    );
  }

  if (active) mountedPanels.add(panelKey);
  if (!mountedPanels.has(panelKey)) return null;
  const classNames = [
    "workbench-panel",
    className,
    active ? "workbench-panel--active" : "workbench-panel--hidden"
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classNames} aria-hidden={!active}>
      {children}
    </div>
  );
}
