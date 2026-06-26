import { useState, useEffect, useCallback } from "react";
import {
  loadVideoSegmentManifest,
  addVideoSegment,
  removeVideoSegment,
  toggleVideoSegment,
} from "./videoSegmentApi";
import type { VideoSegmentManifest, VideoSegment } from "./videoSegmentDomain";

function createEmptyManifest(videoPath: string, videoDurationMs: number): VideoSegmentManifest {
  const now = new Date().toISOString();
  return {
    version: 1,
    videoPath,
    videoName: "",
    videoDurationMs,
    createdAt: now,
    updatedAt: now,
    segments: [],
  };
}

export function useVideoSegments(
  workspaceRoot: string,
  videoPath: string,
  videoDurationMs: number
): {
  manifest: VideoSegmentManifest;
  segments: VideoSegment[];
  loading: boolean;
  error: string | null;
  addSegment: (startMs: number, endMs: number, label?: string) => Promise<void>;
  removeSegment: (id: string) => Promise<void>;
  toggleSegment: (id: string, enabled: boolean) => Promise<void>;
  reloadManifest: () => Promise<void>;
} {
  const [manifest, setManifest] = useState<VideoSegmentManifest>(() =>
    createEmptyManifest(videoPath, videoDurationMs)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadManifest = useCallback(async () => {
    if (!videoPath) {
      setManifest(createEmptyManifest("", videoDurationMs));
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadVideoSegmentManifest(workspaceRoot, videoPath, videoDurationMs);
      setManifest(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceRoot, videoPath, videoDurationMs]);

  useEffect(() => {
    void loadManifest();
  }, [loadManifest]);

  const reloadManifest = useCallback(async () => {
    await loadManifest();
  }, [loadManifest]);

  const addSegment = useCallback(
    async (startMs: number, endMs: number, label?: string) => {
      if (!videoPath) return;
      setLoading(true);
      setError(null);
      try {
        const next = await addVideoSegment(
          workspaceRoot,
          videoPath,
          videoDurationMs,
          startMs,
          endMs,
          label
        );
        setManifest(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [workspaceRoot, videoPath, videoDurationMs]
  );

  const removeSegment = useCallback(
    async (id: string) => {
      if (!videoPath) return;
      setLoading(true);
      setError(null);
      try {
        const next = await removeVideoSegment(workspaceRoot, videoPath, videoDurationMs, id);
        setManifest(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [workspaceRoot, videoPath, videoDurationMs]
  );

  const toggleSegment = useCallback(
    async (id: string, enabled: boolean) => {
      if (!videoPath) return;
      setLoading(true);
      setError(null);
      try {
        const next = await toggleVideoSegment(
          workspaceRoot,
          videoPath,
          videoDurationMs,
          id,
          enabled
        );
        setManifest(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [workspaceRoot, videoPath, videoDurationMs]
  );

  return {
    manifest,
    segments: manifest.segments,
    loading,
    error,
    addSegment,
    removeSegment,
    toggleSegment,
    reloadManifest,
  };
}
