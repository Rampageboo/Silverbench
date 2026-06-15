import { useCallback, useRef, useState, type ReactNode } from "react";
import { ConfirmContext, type ConfirmOptions } from "./confirmContext";

type ConfirmState = ConfirmOptions & {
  open: boolean;
};

const EMPTY_STATE: ConfirmState = {
  open: false,
  message: ""
};

type ConfirmProviderProps = {
  children: ReactNode;
};

export function ConfirmProvider({ children }: ConfirmProviderProps) {
  const [state, setState] = useState<ConfirmState>(EMPTY_STATE);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const closeDialog = useCallback((confirmed: boolean) => {
    setState(EMPTY_STATE);
    resolveRef.current?.(confirmed);
    resolveRef.current = null;
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({
        open: true,
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel,
        danger: options.danger
      });
    });
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state.open ? (
        <div className="app-confirm-backdrop" role="presentation" onClick={() => closeDialog(false)}>
          <div
            className="app-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="app-confirm-title"
            aria-describedby="app-confirm-message"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="app-confirm-title" className="app-confirm-dialog__title">
              {state.title || "Confirm"}
            </h2>
            <p id="app-confirm-message" className="app-confirm-dialog__message">
              {state.message}
            </p>
            <div className="app-confirm-dialog__actions">
              <button type="button" className="app-confirm-dialog__cancel" onClick={() => closeDialog(false)}>
                {state.cancelLabel || "Cancel"}
              </button>
              <button
                type="button"
                className={`app-confirm-dialog__confirm${state.danger ? " app-confirm-dialog__confirm--danger" : ""}`}
                autoFocus
                onClick={() => closeDialog(true)}
              >
                {state.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}
