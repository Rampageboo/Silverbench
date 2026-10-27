import { useCallback, useEffect, useRef, useState } from "react";
import {
  GalleryApiError,
  galleryApi,
  type AssetQuery,
  type GalleryAssetDetail,
  type GalleryAssetSummary,
  type GalleryPrompts,
  type GalleryStatus,
  type PromptOptions
} from "./galleryApi";
import { isDefaultPromptOptions, jobsSignature } from "./galleryDomain";

const POLL_MS = 2500;

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function errorText(error: unknown): string {
  if (error instanceof GalleryApiError) {
    return typeof error.detail === "string" ? error.detail : error.message;
  }
  // fetch() rejects with a bare TypeError when nothing is listening.
  if (error instanceof TypeError) return `Backend not running or unreachable (${error.message})`;
  return error instanceof Error ? error.message : String(error);
}

export type StatusState = {
  status: GalleryStatus | null;
  error: unknown;
  /** Bumps whenever jobs advance/finish or the asset total changes. */
  changeToken: number;
  refresh: () => void;
};

/** Polls /status while the page is visible and reports job/total changes. */
export function useGalleryStatus(active: boolean): StatusState {
  const [status, setStatus] = useState<GalleryStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [changeToken, setChangeToken] = useState(0);
  const signatureRef = useRef("");
  const [kick, setKick] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer = 0;
    const controller = new AbortController();

    async function tick() {
      try {
        const next = await galleryApi.status(controller.signal);
        if (cancelled) return;
        setStatus(next);
        setError(null);
        const signature = jobsSignature(next.jobs, next.total);
        if (signature !== signatureRef.current) {
          // The first load is not a "change"; consumers load on their own.
          if (signatureRef.current) setChangeToken((value) => value + 1);
          signatureRef.current = signature;
        }
      } catch (err) {
        if (cancelled || isAbort(err)) return;
        setError(err);
      }
      if (!cancelled) timer = window.setTimeout(tick, POLL_MS);
    }

    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [active, kick]);

  const refresh = useCallback(() => setKick((value) => value + 1), []);
  return { status, error, changeToken, refresh };
}

export const ASSET_CHUNK = 200;

export type AssetWindow = {
  /** Total matching assets, null until the first chunk of this query arrives. */
  total: number | null;
  error: unknown;
  loading: boolean;
  /** Summary at a list position, or undefined if that chunk is not loaded yet. */
  getItem: (index: number) => GalleryAssetSummary | undefined;
  /** Position of a loaded asset in the current query, or -1. */
  indexOf: (id: string) => number;
  /** Bumps whenever loaded data changes (for dependent effects). */
  version: number;
};

/**
 * Loads the assets of one query in fixed chunks, only around `range` (what
 * the virtual grid renders) plus one chunk ahead. A query change drops
 * everything and aborts in-flight requests; `refreshToken` re-reads the chunks
 * in view and forgets the rest, because inserts shift offsets.
 */
export function useAssetWindow(
  query: Omit<AssetQuery, "offset" | "limit">,
  range: { start: number; end: number },
  enabled: boolean,
  refreshToken: number
): AssetWindow {
  const key = JSON.stringify(query);
  const chunksRef = useRef(new Map<number, GalleryAssetSummary[]>());
  const pendingRef = useRef(new Map<number, AbortController>());
  const generationRef = useRef(0);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  const abortAll = useCallback(() => {
    for (const controller of pendingRef.current.values()) controller.abort();
    pendingRef.current.clear();
    setPendingCount(0);
  }, []);

  const load = useCallback(
    (chunk: number) => {
      if (pendingRef.current.has(chunk)) return;
      const generation = generationRef.current;
      const controller = new AbortController();
      pendingRef.current.set(chunk, controller);
      setPendingCount(pendingRef.current.size);
      galleryApi
        .assets(
          { ...(JSON.parse(key) as AssetQuery), offset: chunk * ASSET_CHUNK, limit: ASSET_CHUNK },
          controller.signal
        )
        .then((result) => {
          if (generation !== generationRef.current) return;
          chunksRef.current.set(chunk, result.items);
          setTotal(result.total);
          setError(null);
          setVersion((value) => value + 1);
        })
        .catch((err) => {
          if (!isAbort(err) && generation === generationRef.current) setError(err);
        })
        .finally(() => {
          if (pendingRef.current.get(chunk) === controller) pendingRef.current.delete(chunk);
          if (generation === generationRef.current) setPendingCount(pendingRef.current.size);
        });
    },
    [key]
  );

  const neededChunks = useCallback(() => {
    const last = Math.max(range.start, range.end - 1);
    const first = Math.floor(range.start / ASSET_CHUNK);
    const through = Math.floor(last / ASSET_CHUNK) + 1; // one chunk of read-ahead
    const limit = total === null ? first : Math.max(0, Math.ceil(total / ASSET_CHUNK) - 1);
    const chunks: number[] = [];
    for (let chunk = first; chunk <= Math.min(through, limit); chunk += 1) chunks.push(chunk);
    return chunks.length ? chunks : [0];
  }, [range.end, range.start, total]);

  // New query: start over.
  useEffect(() => {
    generationRef.current += 1;
    abortAll();
    chunksRef.current = new Map();
    setTotal(null);
    setError(null);
    setVersion((value) => value + 1);
  }, [abortAll, key]);

  // Load what the grid needs.
  useEffect(() => {
    if (!enabled) return;
    for (const chunk of neededChunks()) {
      if (!chunksRef.current.has(chunk)) load(chunk);
    }
  }, [enabled, key, load, neededChunks, version]);

  // Refresh: re-read the chunks in view, forget the others.
  useEffect(() => {
    if (!enabled || !refreshToken) return;
    const keep = new Set(neededChunks());
    for (const chunk of [...chunksRef.current.keys()]) if (!keep.has(chunk)) chunksRef.current.delete(chunk);
    generationRef.current += 1;
    abortAll();
    for (const chunk of keep) load(chunk);
    // Only a refresh request should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  useEffect(() => abortAll, [abortAll]);

  const getItem = useCallback(
    (index: number) => chunksRef.current.get(Math.floor(index / ASSET_CHUNK))?.[index % ASSET_CHUNK],
    // version: chunks are read from a ref; consumers re-render through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  );

  const indexOf = useCallback(
    (id: string) => {
      for (const [chunk, items] of chunksRef.current) {
        const offset = items.findIndex((item) => item.id === id);
        if (offset >= 0) return chunk * ASSET_CHUNK + offset;
      }
      return -1;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  );

  return { total, error, loading: pendingCount > 0, getItem, indexOf, version };
}

/**
 * Full detail for the focused asset. `refreshToken` re-reads the record (for
 * example after a job finished) without touching any unsaved draft, which the
 * page keeps separately.
 */
export function useAssetDetail(id: string | null, refreshToken: number) {
  const [asset, setAsset] = useState<GalleryAssetDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) {
      setAsset(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    // Drop the previous asset immediately so its data is never shown under a new id.
    setAsset((current) => (current?.id === id ? current : null));
    galleryApi
      .asset(id, controller.signal)
      .then((result) => {
        if (result.id !== id) return;
        setAsset(result);
        setError(null);
      })
      .catch((err) => {
        if (!isAbort(err)) setError(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, refreshToken]);

  return { asset, setAsset, error, loading };
}

/**
 * Prompts rendered with the current mode/thresholds. Pure computation on the
 * backend: changing options never re-runs tagging.
 */
export function usePromptPreview(asset: GalleryAssetDetail | null, options: PromptOptions) {
  const [preview, setPreview] = useState<{ id: string; prompts: GalleryPrompts } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const optionsKey = JSON.stringify(options);
  const useDefault = isDefaultPromptOptions(options);
  const assetId = asset?.id ?? null;
  const assetVersion = asset ? `${asset.id}:${asset.modifiedAt}:${JSON.stringify(asset.userEdits)}` : "";

  useEffect(() => {
    if (!assetId || useDefault) {
      setPreview(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    galleryApi
      .preview(assetId, JSON.parse(optionsKey) as PromptOptions, controller.signal)
      .then((prompts) => {
        setPreview({ id: assetId, prompts });
        setError(null);
      })
      .catch((err) => {
        if (!isAbort(err)) setError(err);
      });
    return () => controller.abort();
  }, [assetId, assetVersion, optionsKey, useDefault]);

  if (!asset) return { prompts: null, error: null };
  if (useDefault) return { prompts: asset.prompts, error: null };
  return { prompts: preview?.id === asset.id ? preview.prompts : null, error };
}
