import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { isTauriEnvironment } from "../focus/tauriWindow.ts";

export interface BackupProgressEvent {
  stage: string;
  current: number;
  total: number;
  message: string;
}

export interface BackupResult {
  archive_path: string;
  archive_size: number;
  attachment_count: number;
  warnings: string[];
}

export async function exportBackup(
  onProgress?: (progress: BackupProgressEvent) => void
): Promise<BackupResult> {
  if (!isTauriEnvironment()) {
    throw new Error("Backup export is only available in the desktop application.");
  }

  let unlisten: UnlistenFn | null = null;
  try {
    unlisten = await listen<BackupProgressEvent>("dace://backup-progress", (event) => {
      onProgress?.(event.payload);
    });
    return await invoke<BackupResult>("export_backup", { destinationPath: null });
  } finally {
    if (unlisten) {
      unlisten();
    }
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}