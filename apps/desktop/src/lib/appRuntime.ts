/**
 * The desktop shell's runtime and update state (src-tauri/src/main.rs).
 * Outside the installed app (browser build, source checkout) these report
 * "not packaged" and updates are left to update.bat.
 */
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../app/splashscreen";

export type RuntimeDetail = {
  stage: string;
  message: string;
  percent: number;
  log?: string[];
  error: string | null;
  done: boolean;
};

export type RuntimeStatus = {
  packaged: boolean;
  /** starting | preparing | starting-backend | running | failed */
  phase: string;
  error: string | null;
  detail: RuntimeDetail | null;
};

export type AppInfo = { version: string; packaged: boolean };

export async function runtimeStatus(): Promise<RuntimeStatus | null> {
  if (!inTauri()) return null;
  try {
    return await invoke<RuntimeStatus>("runtime_status");
  } catch {
    return null;
  }
}

export async function retryRuntime() {
  if (inTauri()) await invoke("retry_runtime");
}

export async function appInfo(): Promise<AppInfo | null> {
  if (!inTauri()) return null;
  try {
    return await invoke<AppInfo>("app_info");
  } catch {
    return null;
  }
}

/** Stops the backend process tree so the installer can replace its files. */
export async function prepareForUpdate() {
  if (inTauri()) await invoke("prepare_for_update");
}
