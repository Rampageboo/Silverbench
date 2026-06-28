import { useEffect, useMemo, useRef, useState } from "react";
import { datasetImageUrl } from "../dataset-review/datasetAssets";
import { isFlaggedFile, isReviewedFile } from "../image-pool/metadata";
import { getAnnotationFrameBase64 } from "../video/videoAnnotationApi";
import type { BoxLabelPageModel } from "../box-label/BoxLabelPage";
import type { VideoLabelSession } from "../video/VideoLabelPage";

export type LabelMediaSelection =
  | { kind: "video"; index: number }
  | { kind: "image"; index: number };

type Props = {
  pool: BoxLabelPageModel;
  videoSession: VideoLabelSession;
  selection: LabelMediaSelection;
  onSelectionChange: (selection: LabelMediaSelection) => void;
};

type MediaItem =
  | { kind: "video"; index: number; key: string; name: string; detail: string; taskDetail: string }
  | { kind: "image"; index: number; key: string; name: string; imagePath: string; reviewed: boolean; flagged: boolean };

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "video";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, "0");
  return `${minutes}:${secs}`;
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
        datasetImageUrl(datasetRoot, imagePath)
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

function LazyVideoThumb({ path, name }: { path: string; name: string }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState("");

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !path) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        getAnnotationFrameBase64(path, 0)
          .then((base64) => {
            if (!cancelled) setSrc(base64 ? `data:image/jpeg;base64,${base64}` : "");
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
  }, [path]);

  return src ? <img ref={imgRef} src={src} alt={name} loading="lazy" /> : <div ref={imgRef} className="lwb-media-video-placeholder">VIDEO</div>;
}

function mediaKey(selection: LabelMediaSelection) {
  return `${selection.kind}:${selection.index}`;
}

export function LabelMediaGrid({ pool, videoSession, selection, onSelectionChange }: Props) {
  const mediaItems = useMemo<MediaItem[]>(() => {
    const videos: MediaItem[] = videoSession.videos.map((video, index) => ({
      kind: "video",
      index,
      key: `video:${video.path}`,
      name: video.name || video.path.split(/[/\\]/).at(-1) || "Video",
      detail: formatDuration(video.duration),
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
              const selected = `${item.kind}:${item.index}` === activeKey;
              return (
                <button
                  type="button"
                  key={item.key}
                  className={`lwb-media-tile${selected ? " active" : ""}${item.kind === "image" && item.reviewed ? " reviewed" : ""}${item.kind === "image" && item.flagged ? " flagged" : ""}`}
                  title={item.name}
                  onClick={(event) => {
                    if (item.kind === "image") {
                      pool.selectGalleryImage(item.index, {
                        shiftKey: event.shiftKey,
                        ctrlKey: event.ctrlKey,
                        metaKey: event.metaKey
                      });
                      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
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
                      <LazyVideoThumb path={videoSession.videos[item.index]?.path || ""} name={item.name} />
                    )}
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
