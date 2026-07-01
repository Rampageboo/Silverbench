import { useEffect, useMemo, useRef, useState } from "react";
import { datasetPreviewImageUrl } from "../dataset-review/datasetAssets";
import { isFlaggedFile, isReviewedFile } from "../image-pool/metadata";
import { getAnnotationFrameUrl } from "../video/videoAnnotationApi";
import type { BoxLabelPageModel } from "../box-label/BoxLabelPage";
import type { VideoLabelSession } from "../video/VideoLabelPage";

export type LabelMediaSelection =
  | { kind: "video"; index: number }
  | { kind: "image"; index: number };

type Props = {
  pool: BoxLabelPageModel;
  videoSession: VideoLabelSession;
  selection: LabelMediaSelection;
  activeRevealToken?: number;
  onSelectionChange: (selection: LabelMediaSelection) => void;
};

type MediaItem =
  | { kind: "video"; index: number; key: string; name: string; detail: string; previewSeconds: number; taskDetail: string }
  | { kind: "image"; index: number; key: string; name: string; imagePath: string; reviewed: boolean; flagged: boolean };

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

export function LabelMediaGrid({ pool, videoSession, selection, activeRevealToken = 0, onSelectionChange }: Props) {
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
        flagged: isFlaggedFile(row)
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
        <span>Media</span>
        <div className="lwb-media-actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              void videoSession.addVideos();
            }}
            disabled={!videoSession.annotationsRoot}
          >
            Add Video
          </button>
          <span className="status">
            {activePosition >= 0 ? activePosition + 1 : 0} / {mediaItems.length}
          </span>
        </div>
      </div>
      <div className="lwb-media-filter-row">
        <button type="button" className={pool.imageViewMode === "all" ? "active" : ""} onClick={() => pool.setImageViewMode("all")}>
          All
        </button>
        <button type="button" className={pool.imageViewMode === "hideReviewed" ? "active" : ""} onClick={() => pool.setImageViewMode("hideReviewed")}>
          Hide reviewed
        </button>
        <button type="button" className={pool.imageViewMode === "flagged" ? "active" : ""} onClick={() => pool.setImageViewMode("flagged")}>
          Flagged
        </button>
      </div>
      <div className="panel-body lwb-media-grid-scroll">
        {mediaItems.length ? (
          <div className="lwb-media-grid">
            {mediaItems.map((item) => {
              const active = `${item.kind}:${item.index}` === activeKey;
              const shiftSelected = item.kind === "image" && pool.shiftSelectedBasenames.has(item.name);
              return (
                <button
                  type="button"
                  key={item.key}
                  ref={active ? activeTileRef : null}
                  className={`lwb-media-tile${active ? " active" : ""}${shiftSelected ? " shift-selected" : ""}${item.kind === "image" && item.reviewed ? " reviewed" : ""}${item.kind === "image" && item.flagged ? " flagged" : ""}`}
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
