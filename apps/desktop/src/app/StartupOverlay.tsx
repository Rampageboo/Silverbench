import { useEffect, useRef } from "react";

const STARTUP_FEATURES = [
  { title: "视频截帧", detail: "从视频批量截取训练图片" },
  { title: "图片库", detail: "管理 image_pool 素材与去重" },
  { title: "框标注", detail: "检测框绘制、跟踪与备份恢复" },
  { title: "数据集审核", detail: "浏览、标记与修正标注" },
  { title: "数据集准备", detail: "划分 train/val、生成 data.yaml" },
  { title: "自动标注", detail: "用 .pt 模型预标注或分类" },
  { title: "批量裁剪", detail: "智能裁剪 YOLO 数据集" },
  { title: "掩码清理", detail: "清理分割掩码噪点" },
  { title: "数据集合并", detail: "合并多个数据源或 ZIP" }
] as const;

type StartupOverlayProps = {
  visible: boolean;
  done?: boolean;
  mode?: import("./startupOverlayMode").StartupOverlayMode;
  progress: number;
  stage: string;
  detail: string;
  onPainted?: () => void;
};

export function StartupOverlay({
  visible,
  done = false,
  mode = "overview",
  progress,
  stage,
  detail,
  onPainted
}: StartupOverlayProps) {
  const paintedRef = useRef(false);

  useEffect(() => {
    if (!visible || paintedRef.current) return;

    let cancelled = false;
    const icon = new Image();
    icon.src = "/assets/app-icon.svg";

    function signalPainted() {
      if (cancelled || paintedRef.current) return;
      paintedRef.current = true;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (!cancelled) onPainted?.();
        });
      });
    }

    if (icon.complete) signalPainted();
    else {
      icon.onload = signalPainted;
      icon.onerror = signalPainted;
    }

    return () => {
      cancelled = true;
    };
  }, [visible, onPainted]);

  if (!visible) return null;

  const percent = Math.max(0, Math.min(100, Math.round(progress)));
  const isMinimal = mode === "minimal";

  return (
    <div
      className={`startup-overlay startup-overlay--${mode}${done ? " is-done" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={!done}
    >
      <section className="startup-panel" aria-label="YoloWorkBench startup">
        <header className="startup-hero">
          <img
            className="startup-brand-mark startup-brand-image"
            src="/assets/app-icon.svg"
            width={74}
            height={74}
            alt=""
          />
          <div className="startup-brand-mark startup-brand-abbrev" aria-hidden="true">
            YWB
          </div>
          <div className="startup-copy">
            <h1>YoloWorkBench</h1>
            {!isMinimal ? <p className="startup-tagline">YOLO 数据集全流程工作台</p> : null}
          </div>
        </header>
        {!isMinimal ? (
          <ul className="startup-features" aria-label="Workbench features">
            {STARTUP_FEATURES.map((feature) => (
              <li key={feature.title}>
                <strong>{feature.title}</strong>
                <span>{feature.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="startup-loading">
          <p>{stage}</p>
          <progress value={percent} max={100} />
          <div className="startup-progress-row">
            <span>{detail}</span>
            <span>{percent}%</span>
          </div>
        </div>
      </section>
    </div>
  );
}
