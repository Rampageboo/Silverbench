import type { ReactNode } from "react";

type LogPanelProps = {
  children: ReactNode;
  className?: string;
};

export function LogPanel({ children, className }: LogPanelProps) {
  const classes = ["merge-log", className].filter(Boolean).join(" ");
  return <div className={classes}>{children}</div>;
}
