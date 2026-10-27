import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import { appInfo, prepareForUpdate, retryRuntime, type AppInfo } from "../../lib/appRuntime";

const RECHECK_MS = 6 * 60 * 60 * 1000;

export type UpdateState = {
  info: AppInfo | null;
  update: Update | null;
  checking: boolean;
  /** Bytes downloaded / total while installing; null when idle. */
  progress: { done: number; total: number | null } | null;
  error: string;
  lastChecked: Date | null;
  check: () => Promise<void>;
  install: () => Promise<void>;
};

/**
 * GitHub Release updates for the installed app: checks at start and every six
 * hours. Install = download and verify the signed installer first, then stop
 * the backend, run the installer and restart; a failed download leaves the app
 * running as it was.
 */
export function useAppUpdate(): UpdateState {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<UpdateState["progress"]>(null);
  const [error, setError] = useState("");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const busy = useRef(false);

  const runCheck = useCallback(async (packaged: boolean) => {
    if (!packaged || busy.current) return;
    busy.current = true;
    setChecking(true);
    setError("");
    try {
      setUpdate(await check());
      setLastChecked(new Date());
    } catch (reason) {
      setError(`检查更新失败：${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let timer = 0;
    void appInfo().then((value) => {
      setInfo(value);
      if (!value?.packaged) return;
      void runCheck(true);
      timer = window.setInterval(() => void runCheck(true), RECHECK_MS);
    });
    return () => window.clearInterval(timer);
  }, [runCheck]);

  const install = useCallback(async () => {
    if (!update || busy.current) return;
    busy.current = true;
    setError("");
    setProgress({ done: 0, total: null });
    let stopped = false;
    try {
      await update.download((event) => {
        if (event.event === "Started") setProgress({ done: 0, total: event.data.contentLength ?? null });
        else if (event.event === "Progress")
          setProgress((current) => ({
            done: (current?.done ?? 0) + event.data.chunkLength,
            total: current?.total ?? null
          }));
      });
      await prepareForUpdate();
      stopped = true;
      await update.install();
      await relaunch();
    } catch (reason) {
      setError(`更新失败：${reason instanceof Error ? reason.message : String(reason)}`);
      setProgress(null);
      if (stopped) await retryRuntime(); // bring the backend back; the old version keeps working
    } finally {
      busy.current = false;
    }
  }, [update]);

  return {
    info,
    update,
    checking,
    progress,
    error,
    lastChecked,
    check: () => runCheck(!!info?.packaged),
    install
  };
}
