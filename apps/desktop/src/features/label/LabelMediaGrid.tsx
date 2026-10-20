import { useEffect, useMemo, useRef, useState } from "react";
import { datasetPreviewImageUrl } from "../dataset-review/datasetAssets";
import { isFlaggedFile, isNextTrainingFile, isReviewedFile } from "../image-pool/metadata";
import { getAnnotationFrameUrl } from "../video/videoAnnotationApi";
import type { BoxLabelModel } from "../box-label/useBoxLabel";
import type { VideoAnnotationSession } from "../video/useVideoAnnotationSession";
import { IconPlus, IconSidebar } from "../../ui/icons";

export type LabelMediaSelection =
  | { kind: "video"; index: number }
  | { kind: "image"; index: number };

type Props = {
  pool: BoxLabelModel;
  videoSession: VideoAnnotationSession;
  selection: LabelMediaSelection;
  loading?: boolean;
  activeRevealToken?: number;
  onSelectionChange: (selection: LabelMediaSelection) => void;
  /** Collapse the media rail. */
  onCollapse?: () => void;
};

type MediaItem =
  | { kind: "video"; index: number; key: string; name: string; detail: string; previewSeconds: number; taskDetail: string }
  | { kind: "image"; index: number; key: string; name: string; imagePath: string; reviewed: boolean; flagged: boolean; nextTraining: boolean };

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${secs}`;
  return `${String(minutes).padStart(2, "0")}:${secs}`;
}

function thumbnailPreviewSeconds(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const latest = Math.max(0, duration - 0.001);
  return Math.min(latest, Math.max(1, duration * 0.1));
}

function LazyImageThumb({ datasetRoot, imagePath }: { datasetRoot: string; imagePath: string }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState("");

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !datasetRoot) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        datasetPreviewImageUrl(datasetRoot, imagePath, 360, 60)
          .then((url) => {
            if (!cancelled) setSrc(url);
          })
          .catch(() => {});
        observer.disconnect();
      },
      { rootMargin: "240px" }
    );
    observer.observe(img);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [datasetRoot, imagePath]);

  return <img ref={imgRef} src={src || undefined} alt={imagePath} loading="lazy" />;
}

function LazyVideoThumb({
  workspaceRoot,
  path,
  name,
  seconds
}: {
  workspaceRoot: string;
  path: string;
  name: string;
  seconds: number;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState("");

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !workspaceRoot || !path) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (!cancelled) setSrc(getAnnotationFrameUrl(workspaceRoot, path, seconds, { fast: true }));
        observer.disconnect();
      },
      { rootMargin: "240px" }
    );
    observer.observe(img);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [path, seconds, workspaceRoot]);

  return src ? <img ref={imgRef} src={src} alt={name} loading="lazy" /> : <div ref={imgRef} className="lwb-media-video-placeholder">VIDEO</div>;
}

function mediaKey(selection: LabelMediaSelection) {
  return `${selection.kind}:${selection.index}`;
}

const MEDIA_FILTERS = [
  { value: "all", label: "All", title: "Show all media" },
  { value: "hideReviewed", label: "To do", title: "Hide reviewed images" },
  { value: "flagged", label: "Flagged", title: "Only flagged images" },
  { value: "nextTraining", label: "★ Next", title: "Queued for next training" }
] as const;

export function LabelMediaGrid({
  pool,
  videoSession,
  selection,
  loading = false,
  activeRevealToken = 0,
  onSelectionChange,
  onCollapse
}: Props) {
  const activeTileRef = useRef<HTMLButtonElement | null>(null);
  const mediaItems = useMemo<MediaItem[]>(() => {
    const videos: MediaItem[] = videoSession.videos.map((video, index) => ({
      kind: "video",
      index,
      key: `video:${video.path}`,
      name: video.name || video.path.split(/[/\\]/).at(-1) || "Video",
      detail: formatDuration(video.duration),
      previewSeconds: thumbnailPreviewSeconds(video.duration),
      taskDetail: "detect + classify"
    }));
    const images: MediaItem[] = pool.entries.map((entry, index) => {
      const row = pool.metadata.get(entry.basename);
      return {
        kind: "image",
        index,
        key: `image:${entry.imagePath}`,
        name: entry.basename,
        imagePath: entry.imagePath,
        reviewed: isReviewedFile(row),
        flagged: isFlaggedFile(row),
        nextTraining: isNextTrainingFile(row)
      };
    });
    return [...videos, ...images];
  }, [pool.entries, pool.metadata, videoSession.videos]);

  const activeKey = mediaKey(selection);
  const activePosition = mediaItems.findIndex((item) => `${item.kind}:${item.index}` === activeKey);

  useEffect(() => {
    if (!activeRevealToken) return;
    activeTileRef.current?.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "smooth"
    });
  }, [activeRevealToken]);

  return (
    <section className="panel lwb-media-panel" aria-label="Media">
      <div className="panel-header lwb-media-header">
        {onCollapse ? (
          <button
            type="button"
            className="ui-btn--ghost ui-btn--icon ui-btn--sm"
            onClick={onCollapse}
            title="Hide media"
            aria-label="Hide media"
          >
            <IconSidebar size={14} />
          </button>
        ) : null}
        <span className="lwb-media-title">Media</span>
        <span className="status lwb-media-count">
          {activePosition >= 0 ? activePosition + 1 : 0} / {mediaItems.length}
        </span>
        <button
          type="button"
          className="ui-btn--ghost ui-btn--icon ui-btn--sm"
          onClick={() => {
            void videoSession.addVideos();
          }}
          title="Add video"
          aria-label="Add video"
        >
          <IconPlus size={14} />
        </button>
      </div>
      <div className="ui-seg lwb-media-filter-row" role="group" aria-label="Image filter">
        {MEDIA_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            aria-pressed={pool.imageViewMode === filter.value}
            title={filter.title}
            onClick={() => pool.setImageViewMode(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>
      <div className="panel-body lwb-media-grid-scroll">
        {loading ? (
          <div className="empty">Loading media...</div>
        ) : mediaItems.length ? (
          <div className="lwb-media-grid">
            {mediaItems.map((item) => {
              const active = `${item.kind}:${item.index}` === activeKey;
              const shiftSelected = item.kind === "image" && pool.shiftSelectedBasenames.has(item.name);
              return (
                <button
                  type="button"
                  key={item.key}
                  ref={active ? activeTileRef : null}
                  className={`lwb-media-tile${active ? " active" : ""}${shiftSelected ? " shift-selected" : ""}${item.kind === "image" && item.reviewed ? " reviewed" : ""}${item.kind === "image" && item.flagged ? " flagged" : ""}${item.kind === "image" && item.nextTraining ? " next-training" : ""}`}
                  title={item.name}
                  onClick={(event) => {
                    if (item.kind === "image") {
                      const modifierSelect = event.shiftKey || event.ctrlKey || event.metaKey;
                      if (modifierSelect && selection.kind !== "image") {
                        pool.selectGalleryImage(item.index);
                        onSelectionChange({ kind: "image", index: item.index });
                        return;
                      }
                      pool.selectGalleryImage(item.index, {
                        shiftKey: event.shiftKey,
                        ctrlKey: event.ctrlKey,
                        metaKey: event.metaKey
                      });
                      if (modifierSelect) {
                        onSelectionChange({ kind: "image", index: selection.kind === "image" ? selection.index : item.index });
                        return;
                      }
                    } else {
                      videoSession.setCurrentIndex(item.index);
                    }
                    onSelectionChange({ kind: item.kind, index: item.index });
                  }}
                >
                  <span className="lwb-media-thumb">
                    <span className={`lwb-media-kind lwb-media-kind--${item.kind}`}>{item.kind === "image" ? "IMG" : "VIDEO"}</span>
                    {item.kind === "image" ? (
                      <LazyImageThumb datasetRoot={pool.datasetRoot} imagePath={item.imagePath} />
                    ) : (
                      <LazyVideoThumb
                        workspaceRoot={pool.datasetRoot}
                        path={videoSession.videos[item.index]?.path || ""}
                        name={item.name}
                        seconds={item.previewSeconds}
                      />
                    )}
                    {item.kind === "video" && item.detail ? <span className="lwb-media-duration">{item.detail}</span> : null}
                    {item.kind === "image" && item.nextTraining ? (
                      <span className="lwb-media-next-training" title="Queued for next training" aria-label="Queued for next training">★</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="empty">No images or videos loaded.</div>
        )}
      </div>
    </section>
  );
}
