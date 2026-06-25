import { useWorkspace } from "../../app/useWorkspace";
import { VideoAnnotationCanvas } from "./VideoAnnotationCanvas";
import { formatVideoClock } from "./videoAnnotationDomain";
import { useVideoAnnotationSession } from "./useVideoAnnotationSession";
import "./VideoLabelPage.css";

type Props = {
  onReady?: () => void;
  active?: boolean;
};

export function VideoLabelPage({ onReady, active = true }: Props) {
  const { workspaceRoot, chooseWorkspaceFolder } = useWorkspace();
  const session = useVideoAnnotationSession({ workspaceRoot, active, onReady });
  const saveLabel =
    session.saveState === "saving"
      ? "Saving…"
      : session.saveState === "saved"
        ? "Saved"
        : session.saveState === "error"
          ? "Save failed"
          : "Not edited";
  const videoMeta = session.current
    ? `${session.current.width}×${session.current.height} · ${formatVideoClock(session.current.duration)}`
    : "No video loaded";

  return (
    <main className="video-label-workspace">
      <section className="panel video-label-main-panel">
        <div className="panel-header">
          <span>Video Label</span>
          <span className="status">{videoMeta}</span>
        </div>
        <div className="panel-body video-label-main-body">
          <div className="row workspace-toolbar">
            <button
              className="primary"
              type="button"
              onClick={() => chooseWorkspaceFolder().catch((reason) => session.showError(reason, "workspace.open"))}
            >
              Open Workspace
            </button>
            <button
              className="primary"
              type="button"
              onClick={() => void session.addVideos()}
              disabled={!workspaceRoot.trim()}
            >
              Add Video
            </button>
            <span className="status">{saveLabel}</span>
          </div>

          <div className="video-label-stage">
            {session.current && session.previewBase64 ? (
              <VideoAnnotationCanvas
                imageBase64={session.previewBase64}
                boxes={session.boxes}
                classes={session.classes}
                currentClass={session.currentClass}
                selectedIndex={session.selectedIndex}
                disabled={session.previewLoading || session.manifestLoading}
                onChange={(next) => session.updateCurrentFrame(next, true)}
                onSelectedIndexChange={session.setSelectedIndex}
              />
            ) : (
              <div className="empty video-label-empty">
                {session.previewLoading || session.manifestLoading
                  ? "Loading video frame…"
                  : "Add a video to begin direct frame annotation."}
              </div>
            )}
          </div>

          <div className="video-label-timeline">
            <input
              type="range"
              min="0"
              max={session.maxTime}
              step="0.001"
              value={Math.min(session.time, session.maxTime)}
              disabled={!session.current}
              onChange={(event) => session.gotoTime(Number(event.target.value))}
              aria-label="Video timestamp"
            />
            <div className="row video-label-time-row">
              <button
                type="button"
                onClick={() => session.gotoTime(session.time - session.stepSeconds)}
                disabled={!session.current}
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => session.gotoTime(session.time + session.stepSeconds)}
                disabled={!session.current}
              >
                Next
              </button>
              <label>
                Time (s)
                <input
                  type="number"
                  min="0"
                  max={session.maxTime}
                  step="0.001"
                  value={session.time}
                  onChange={(event) => session.gotoTime(Number(event.target.value))}
                  disabled={!session.current}
                />
              </label>
              <label>
                Step (s)
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={session.stepSeconds}
                  onChange={(event) => session.setStepSeconds(Math.max(0.001, Number(event.target.value) || 0.1))}
                />
              </label>
              <span className="video-label-clock">
                {formatVideoClock(session.time)} / {formatVideoClock(session.current?.duration || 0)}
              </span>
            </div>
          </div>
        </div>
      </section>

      <aside className="side-stack video-label-side-stack">
        <section className="panel">
          <div className="panel-header">
            <span>Videos</span>
            <span className="status">{session.videos.length}</span>
          </div>
          <div className="panel-body">
            <div className="video-list">
              {session.videos.length ? (
                session.videos.map((video, index) => (
                  <div
                    className={`video-list-item${index === session.currentIndex ? " active" : ""}`}
                    key={video.path}
                  >
                    <button
                      type="button"
                      className="video-list-select"
                      onClick={() => session.setCurrentIndex(index)}
                    >
                      {video.name}
                    </button>
                    <button
                      type="button"
                      className="video-list-remove"
                      onClick={() => session.removeVideo(index)}
                      aria-label={`Remove ${video.name}`}
                    >
                      Remove
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty">No videos added.</div>
              )}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <span>Current Frame</span>
            <span className="status">{session.boxes.length} box(es)</span>
          </div>
          <div className="panel-body video-label-action-stack">
            <div className="row">
              <button
                type="button"
                onClick={() => session.gotoReviewed(-1)}
                disabled={!session.reviewedFrames.length}
              >
                Previous Reviewed
              </button>
              <button
                type="button"
                onClick={() => session.gotoReviewed(1)}
                disabled={!session.reviewedFrames.length}
              >
                Next Reviewed
              </button>
            </div>
            <button
              type="button"
              onClick={session.copyPreviousBoxes}
              disabled={!session.annotatedFrames.length || !session.current}
            >
              Copy Previous Boxes
            </button>
            <button type="button" onClick={session.markEmptyReviewed} disabled={!session.current}>
              Mark Empty / Reviewed
            </button>
            <button
              type="button"
              className="danger"
              onClick={session.clearFrameRecord}
              disabled={!session.currentFrame}
            >
              Clear Frame Record
            </button>
            <div className="video-label-stats">
              <span>{session.reviewedFrames.length} reviewed timestamp(s)</span>
              <span>{session.annotatedFrames.length} with boxes</span>
              <span>Current: {session.reviewed ? "reviewed" : "not reviewed"}</span>
            </div>
          </div>
        </section>

        <section className="panel video-label-class-panel">
          <div className="panel-header">
            <span>Classes</span>
            <span className="status">{session.currentClass}</span>
          </div>
          <div className="panel-body">
            <div className="video-label-class-list">
              {session.classes.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={item.id === session.currentClass ? "selected" : ""}
                  onClick={() => session.assignClass(item.id)}
                >
                  {item.id}: {item.name}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-body">
            <div className="hint">{session.status}</div>
            <div className="hint">
              Timestamp/box metadata: {session.annotationsRoot}. Preview frames remain in memory and are never added to image_pool.
            </div>
            <div className="hint">Image-based annotation remains available in Image Box Label.</div>
          </div>
        </section>
      </aside>
    </main>
  );
}
