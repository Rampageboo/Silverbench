type BackendStatusBannerProps = {
  /** Show when the backend health poll is failing after initial startup. */
  visible: boolean;
};

/**
 * Global, non-blocking notice that the FastAPI backend dropped mid-session.
 * Recovery is automatic — `useBackend` keeps polling /health and this hides
 * itself once the backend answers again. The Rust shell does not yet respawn
 * a crashed child, so a persistent banner means the process needs a restart.
 */
export function BackendStatusBanner({ visible }: BackendStatusBannerProps) {
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        padding: "8px 16px",
        textAlign: "center",
        fontSize: 13,
        background: "#7f1d1d",
        color: "#fecaca",
        borderBottom: "1px solid #b91c1c"
      }}
    >
      后端连接已断开，正在重试…（若长时间无法恢复，请重启应用）
    </div>
  );
}
