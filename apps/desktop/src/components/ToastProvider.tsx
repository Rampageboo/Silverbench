import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ToastContext, type ToastVariant } from "./toastContext";

type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
};

const TOAST_DURATION_MS = 3000;

type ToastProviderProps = {
  children: ReactNode;
};

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, options?: { variant?: ToastVariant }) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      const id = nextIdRef.current + 1;
      nextIdRef.current = id;
      const variant = options?.variant ?? "info";
      setToasts((current) => [...current, { id, message: trimmed, variant }]);
      const timer = window.setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
      timersRef.current.set(id, timer);
    },
    [dismissToast]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="app-toast-stack" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <div key={toast.id} className={`app-toast app-toast--${toast.variant}`} role="status">
            <span className="app-toast__message">{toast.message}</span>
            <button type="button" className="app-toast__close" aria-label="Dismiss" onClick={() => dismissToast(toast.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
