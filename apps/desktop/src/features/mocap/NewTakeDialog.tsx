import { useEffect, useState, type ReactNode } from "react";
import { PathField } from "../../components/PathField";
import { IconClose } from "../../ui/icons";
import { listWorkspaceVideos, type VideoItem } from "../video/videoCaptureApi";
import { mocapApi, type Take, type TakeOptions, type TakeSource } from "./mocapApi";

type Props = {
  workspaceRoot: string;
  onClose: () => void;
  onCreated: (take: Take, start: boolean) => void;
};

/** Studio's direction presets for separately recorded multiview clips. */
const PRESETS: Record<string, { label: string; yaws: number[] }> = {
  fan3: { label: "Fan of 3 (−45°, 0°, 45°)", yaws: [-45, 0, 45] },
  cardinal4: { label: "4 sides (0°, 90°, 180°, 270°)", yaws: [0, 90, 180, 270] }
};

export function NewTakeDialog({ workspaceRoot, onClose, onCreated }: Props) {
  const [videos, setVideos] = useState<VideoItem[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [yaws, setYaws] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [vlm, setVlm] = useState(false);
  const [upscale, setUpscale] = useState(true);
  const [interval, setExpertInterval] = useState<TakeOptions["expertInterval"]>("2");
  const [profile, setProfile] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listWorkspaceVideos(workspaceRoot)
      .then(setVideos)
      .catch((reason) =>
        setError(`Cannot list videos: ${reason instanceof Error ? reason.message : String(reason)}`)
      );
  }, [workspaceRoot]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const multiview = selected.length > 1;

  function toggle(path: string) {
    setSelected((current) =>
      current.includes(path)
        ? current.filter((value) => value !== path)
        : current.length < 8
          ? [...current, path]
          : current
    );
  }

  function applyPreset(key: string) {
    const preset = PRESETS[key];
    setYaws(Object.fromEntries(selected.map((path, index) => [path, preset.yaws[index] ?? 0])));
  }

  async function create(start: boolean) {
    setBusy(true);
    setError("");
    try {
      const sources: TakeSource[] = selected.map((video, index) =>
        multiview ? { id: `view_${index + 1}`, video, yaw: yaws[video] ?? 0 } : { id: "main", video }
      );
      const take = await mocapApi.createTake(workspaceRoot, {
        name: name.trim() || undefined,
        sources,
        options: {
          vlm,
          upscale,
          expertInterval: interval,
          characterProfile: profile || null,
          appearanceReference: vlm && reference ? reference : null
        }
      });
      onCreated(take, start);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="New capture"
      onClose={onClose}
      footer={
        <>
          {error ? <span className="ui-error mc-dialog-error">{error}</span> : null}
          <button type="button" className="ui-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !selected.length} onClick={() => void create(false)}>
            Create only
          </button>
          <button
            type="button"
            className="mc-primary"
            disabled={busy || !selected.length}
            onClick={() => void create(true)}
          >
            Create and capture
          </button>
        </>
      }
    >
      <div className="mc-form">
        <div className="ui-field">
          <span className="ui-eyebrow">Videos</span>
          <div className="mc-video-list">
            {videos === null ? <span className="mc-muted">Reading workspace videos…</span> : null}
            {videos?.length === 0 ? (
              <span className="mc-muted">No videos in media/. Import some first</span>
            ) : null}
            {videos?.map((video) => {
              const index = selected.indexOf(video.path);
              return (
                <label key={video.path} className={`mc-video-row${index >= 0 ? " is-selected" : ""}`}>
                  <input type="checkbox" checked={index >= 0} onChange={() => toggle(video.path)} />
                  <span className="mc-video-row__name">{video.name}</span>
                  <span className="mc-muted">
                    {video.width}×{video.height} · {video.duration.toFixed(1)} s
                  </span>
                  {multiview && index >= 0 ? (
                    <span className="mc-video-row__yaw">
                      Yaw
                      <input
                        type="number"
                        step={15}
                        value={yaws[video.path] ?? 0}
                        onChange={(event) =>
                          setYaws((current) => ({ ...current, [video.path]: Number(event.target.value) }))
                        }
                      />
                      °
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
          {multiview ? (
            <div className="mc-inline">
              <span className="mc-muted">Presets</span>
              {Object.entries(PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  className="ui-btn--sm"
                  onClick={() => applyPreset(key)}
                  disabled={selected.length !== preset.yaws.length}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <label className="ui-field">
          <span className="ui-eyebrow">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Video file name"
          />
        </label>
        <div className="mc-options">
          <label className="ui-field">
            <span className="ui-eyebrow">Expert interval</span>
            <select
              value={interval}
              onChange={(event) => setExpertInterval(event.target.value as TakeOptions["expertInterval"])}
            >
              <option value="1">Every frame</option>
              <option value="2">Every 2 frames</option>
              <option value="3">Every 3 frames</option>
              <option value="auto">Auto</option>
            </select>
          </label>
          <label className="mc-check">
            <input type="checkbox" checked={upscale} onChange={(event) => setUpscale(event.target.checked)} />
            AI upscale (Maxine VSR 2×)
          </label>
          <label className="mc-check">
            <input type="checkbox" checked={vlm} onChange={(event) => setVlm(event.target.checked)} />
            Visual correction (Qwen3-VL, needs Ollama)
          </label>
        </div>
        {vlm ? (
          <PathField
            label="Appearance reference"
            kind="file"
            value={reference}
            onChange={setReference}
            filters={[{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]}
          />
        ) : null}
        <PathField
          label="Character profile"
          kind="file"
          value={profile}
          onChange={setProfile}
          filters={[{ name: "JSON", extensions: ["json"] }]}
        />
      </div>
    </Dialog>
  );
}

function Dialog({
  title,
  onClose,
  children,
  footer
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="ui-dialog-scrim" role="presentation" onPointerDown={onClose}>
      <section
        className="ui-dialog ui-dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <header className="ui-dialog__head">
          <h2 className="ui-dialog__title">{title}</h2>
          <button
            type="button"
            className="ui-btn--ghost ui-btn--icon ui-btn--sm"
            onClick={onClose}
            aria-label="Close"
          >
            <IconClose size={14} />
          </button>
        </header>
        <div className="ui-dialog__body">{children}</div>
        <footer className="ui-dialog__foot">{footer}</footer>
      </section>
    </div>
  );
}
