import { FC, useEffect, useRef } from "react";
import { formatBytes } from "./backupApi";
import { formatArchiveDate, RestorePreview } from "./restoreApi";
import { useDismissable } from "../core/useDismissable";

interface RestoreBackupDialogProps {
  preview: RestorePreview;
  busy: boolean;
  progress: string | null;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function fileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

export const RestoreBackupDialog: FC<RestoreBackupDialogProps> = ({
  preview,
  busy,
  progress,
  error,
  onConfirm,
  onCancel,
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useDismissable(
    true,
    () => {
      if (!busy) onCancel();
    },
    dialogRef,
    { group: "workspace-overlay", restoreFocus: true }
  );

  const rows: Array<[string, string]> = [
    ["Archive", fileName(preview.archive_path)],
    ["Created", formatArchiveDate(preview.created_at)],
    ["Dace version", preview.app_version || "Unknown"],
    ["Schema version", String(preview.schema_version)],
    ["Archive size", formatBytes(preview.archive_size)],
    ["Records", String(preview.record_count)],
    ["Tags", String(preview.tag_count)],
    ["Relationships", String(preview.relationship_count)],
    ["Attachments", String(preview.attachment_count)],
    ["Highlights", String(preview.highlight_count)],
    ["Annotations", String(preview.annotation_count)],
    ["Validation", preview.validation_status === "valid" ? "Integrity checks passed" : preview.validation_status],
    ["Apply", "Requires a restart"],
  ];

  return (
    <div
      className="overlay-backdrop"
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="shortcut-modal restore-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="restore-dialog-title"
        aria-describedby="restore-dialog-warning"
      >
        <div className="shortcut-modal-header">
          <div className="shortcut-modal-title" id="restore-dialog-title">
            Restore Backup
          </div>
          <button
            type="button"
            className="panel-close-btn"
            onClick={onCancel}
            disabled={busy}
            aria-label="Cancel restore"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="shortcut-modal-body restore-body">
          <div className="restore-warning" id="restore-dialog-warning" role="alert">
            <strong>This replaces your current library.</strong> Dace validates the archive, creates a
            recovery snapshot, then requests a restart to apply the restored data. If Dace does not
            reopen automatically, launch it again. Changes made after this point are not part of the
            restore.
          </div>

          <dl className="restore-summary">
            {rows.map(([label, value]) => (
              <div key={label} className="restore-summary-row">
                <dt>{label}</dt>
                <dd title={label === "Archive" ? preview.archive_path : undefined}>{value}</dd>
              </div>
            ))}
          </dl>

          {preview.warnings.length > 0 && (
            <ul className="restore-warnings">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          {busy && <div className="restore-progress" role="status">{progress || "Preparing restore…"}</div>}
          {error && <div className="restore-error" role="alert">{error}</div>}
        </div>

        <div className="command-palette-footer restore-footer">
          <button type="button" className="primary-outline-btn" onClick={onCancel} disabled={busy} ref={cancelRef}>
            Cancel
          </button>
          <button type="button" className="restore-confirm-btn" onClick={onConfirm} disabled={busy}>
            {busy ? "Staging restore…" : "Replace Data & Request Restart"}
          </button>
        </div>
      </div>
    </div>
  );
};
