import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { isTauriEnvironment } from "../focus/tauriWindow.ts";

export interface RestoreProgressEvent {
  stage: string;
  current: number;
  total: number;
  message: string;
}

export interface RestorePreview {
  archive_path: string;
  archive_size: number;
  archive_sha256: string;
  created_at: string;
  app_version: string;
  schema_version: number;
  record_count: number;
  tag_count: number;
  relationship_count: number;
  attachment_count: number;
  highlight_count: number;
  annotation_count: number;
  validation_status: string;
  warnings: string[];
}

export interface RestoreStartResult {
  preview: RestorePreview;
  restart_required: boolean;
  recovery_dir: string;
}

export interface RestoreOutcome {
  success: boolean;
  message: string;
  archive_path: string | null;
  record_count: number | null;
  attachment_count: number | null;
  recovery_dir: string | null;
  completed_at: string;
}

function ensureDesktop(): void {
  if (!isTauriEnvironment()) {
    throw new Error("Backup restore is only available in the desktop application.");
  }
}

/**
 * Validates an archive and returns a preview without touching live data.
 * When no path is supplied, the native file picker is shown.
 */
export async function inspectBackupArchive(): Promise<RestorePreview> {
  ensureDesktop();
  return invoke<RestorePreview>("inspect_backup_archive", { archivePath: null });
}

/**
 * Stages a validated restore, creates a recovery snapshot, and requests an
 * app restart. The replacement happens at startup before the database opens.
 */
export async function restoreBackupArchive(
  archivePath: string,
  expectedArchiveSize: number,
  expectedArchiveSha256: string,
  onProgress?: (progress: RestoreProgressEvent) => void
): Promise<RestoreStartResult> {
  ensureDesktop();

  let unlisten: UnlistenFn | null = null;
  try {
    unlisten = await listen<RestoreProgressEvent>("dace://restore-progress", (event) => {
      onProgress?.(event.payload);
    });
    return await invoke<RestoreStartResult>("restore_backup_archive", {
      archivePath,
      expectedArchiveSize,
      expectedArchiveSha256,
    });
  } finally {
    if (unlisten) {
      unlisten();
    }
  }
}

/** Returns (and consumes) the result of the restore applied on startup. */
export async function getRestoreResult(): Promise<RestoreOutcome | null> {
  if (!isTauriEnvironment()) {
    return null;
  }
  return invoke<RestoreOutcome | null>("get_restore_result");
}

export function formatArchiveDate(value: string): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}
