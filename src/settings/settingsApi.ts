import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../focus/tauriWindow";
import { normalizeSettings, SETTINGS_FALLBACK_KEY } from "./settingsSchema";
import type { AppInfo, AppSettings, StorageInfo } from "./types";

function loadFallbackSettings(): AppSettings {
  if (typeof window === "undefined") return normalizeSettings(null);
  try {
    const raw = window.localStorage.getItem(SETTINGS_FALLBACK_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeSettings(null);
  }
}

function storeFallbackSettings(settings: AppSettings): AppSettings {
  const normalized = normalizeSettings(settings);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SETTINGS_FALLBACK_KEY, JSON.stringify(normalized));
    } catch {
      // Preview-mode persistence is best-effort; the desktop store is authoritative.
    }
  }
  return normalized;
}

export async function getAppSettings(): Promise<AppSettings> {
  if (!isTauriEnvironment()) return loadFallbackSettings();
  const settings = await invoke<unknown>("get_app_settings");
  return normalizeSettings(settings);
}

export async function updateAppSettings(settings: AppSettings): Promise<AppSettings> {
  const normalized = normalizeSettings(settings);
  if (!isTauriEnvironment()) return storeFallbackSettings(normalized);
  const saved = await invoke<unknown>("update_app_settings", { settings: normalized });
  return normalizeSettings(saved);
}

export async function resetAppSettings(): Promise<AppSettings> {
  if (!isTauriEnvironment()) return storeFallbackSettings(normalizeSettings(null));
  const reset = await invoke<unknown>("reset_app_settings");
  return normalizeSettings(reset);
}

export async function pickBackupDirectory(current: string | null): Promise<string | null> {
  if (!isTauriEnvironment()) {
    throw new Error("Folder selection is only available in the desktop application.");
  }
  return invoke<string | null>("pick_backup_directory", { current });
}

export async function getStorageInfo(): Promise<StorageInfo> {
  if (!isTauriEnvironment()) {
    return {
      appDataDir: "Browser preview (no native app data directory)",
      databasePath: null,
      databaseBytes: 0,
      attachmentsDir: "Browser preview",
      attachmentBytes: 0,
      attachmentCount: 0,
      schemaVersion: 0,
      fts5Available: false,
      pendingRestore: false,
      lastRestoreMessage: null,
    };
  }
  return invoke<StorageInfo>("get_storage_info");
}

export async function getAppInfo(): Promise<AppInfo> {
  if (!isTauriEnvironment()) {
    return {
      name: "Dace",
      version: "0.1.0",
      tauriVersion: "browser preview",
      platform: typeof navigator === "undefined" ? "unknown" : navigator.platform || "browser",
      architecture: "browser",
      buildMode: "preview",
    };
  }
  return invoke<AppInfo>("get_app_info");
}
