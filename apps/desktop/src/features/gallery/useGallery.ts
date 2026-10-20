import { useCallback, useEffect, useRef, useState } from "react";
import {
  GalleryApiError,
  galleryApi,
  type AssetQuery,
  type GalleryAssetDetail,
  type GalleryPageResult,
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
  if (error instanceof TypeError) return `后端未运行或无法访问（${error.message}）`;
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

/** One page of assets. Older responses never overwrite a newer query. */
export function useAssetPage(query: AssetQuery, enabled: boolean, refreshToken: number) {
  const [page, setPage] = useState<GalleryPageResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify(query);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    galleryApi
      .assets(JSON.parse(key) as AssetQuery, controller.signal)
      .then((result) => {
        setPage(result);
        setError(null);
      })
      .catch((err) => {
        if (!isAbort(err)) setError(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [enabled, key, refreshToken]);

  return { page, error, loading };
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
