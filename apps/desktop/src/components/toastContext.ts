import { createContext } from "react";

export type ToastVariant = "info" | "error";

export type ToastContextValue = {
  showToast: (message: string, options?: { variant?: ToastVariant }) => void;
};

export const ToastContext = createContext<ToastContextValue | null>(null);
