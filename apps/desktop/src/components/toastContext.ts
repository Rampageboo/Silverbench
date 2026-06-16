import { createContext } from "react";

export type ToastVariant = string;

export type ToastContextValue = {
  showToast: (message: string, options?: { variant?: ToastVariant }) => void;
};

export const ToastContext = createContext<ToastContextValue | null>(null);
