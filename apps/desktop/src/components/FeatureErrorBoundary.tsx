import { Component, type ErrorInfo, type ReactNode } from "react";
import { errMessage } from "../lib/errors";

type FeatureErrorBoundaryProps = {
  /** Human-readable feature name shown in the fallback, e.g. "Label". */
  label: string;
  children: ReactNode;
};

type FeatureErrorBoundaryState = {
  error: Error | null;
};

/**
 * Isolates a feature panel so a runtime exception (e.g. a malformed label
 * file) renders an inline error card instead of crashing the whole React
 * tree. "Retry" remounts only this panel's subtree.
 */
export class FeatureErrorBoundary extends Component<FeatureErrorBoundaryProps, FeatureErrorBoundaryState> {
  state: FeatureErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): FeatureErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Surface to the console for diagnostics; the card covers the user-facing path.
    console.error(`[${this.props.label}] render error`, error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          margin: "24px",
          padding: "20px 22px",
          borderRadius: 10,
          border: "1px solid #7f1d1d",
          background: "#111827",
          color: "#e5e7eb",
          maxWidth: 640
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
          {this.props.label} failed to load
        </div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 14, wordBreak: "break-word" }}>
          {errMessage(error)}
        </div>
        <button
          type="button"
          onClick={this.handleRetry}
          style={{
            background: "#1f6feb",
            color: "#ffffff",
            border: "none",
            borderRadius: 6,
            padding: "7px 16px",
            fontSize: 13,
            cursor: "pointer"
          }}
        >
          Retry
        </button>
      </div>
    );
  }
}
