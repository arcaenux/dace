import type {
  RestoreInspectProgressEvent,
  RestoreOutcome,
} from "./restoreApi.ts";

export function archiveFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

export function inspectionProgressMessage(
  progress: RestoreInspectProgressEvent | null
): string {
  if (!progress?.message) return "Inspecting backup archive…";
  return progress.message;
}

export function inspectionSuccessMessage(archivePath: string): string {
  return `Integrity checks passed for ${archiveFileName(archivePath)}. Review the restore summary.`;
}

export function restoreStagedMessage(restartRequired: boolean): string {
  if (!restartRequired) {
    return "Restore staged.";
  }
  return "Restore staged. Dace will request a restart to apply it; if it does not reopen automatically, launch Dace again.";
}

export function restoreOutcomeNotice(outcome: RestoreOutcome): string {
  if (outcome.success) {
    return `Restore complete — ${outcome.record_count ?? 0} records and ${
      outcome.attachment_count ?? 0
    } attachments verified.`;
  }
  return `Restore failed: ${outcome.message}`;
}
