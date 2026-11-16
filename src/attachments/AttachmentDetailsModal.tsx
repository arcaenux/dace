import { FC, useState, useEffect } from "react";
import { AttachmentDetails, formatFileSize } from "./types";
import * as api from "./attachmentsApi";

interface AttachmentDetailsModalProps {
  attachmentId: string;
  onClose: () => void;
  onShowNotice: (msg: string) => void;
}

export const AttachmentDetailsModal: FC<AttachmentDetailsModalProps> = ({
  attachmentId,
  onClose,
  onShowNotice,
}) => {
  const [details, setDetails] = useState<AttachmentDetails | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [copiedHash, setCopiedHash] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      try {
        const res = await api.getAttachmentDetails(attachmentId);
        if (isMounted) setDetails(res);
      } catch (err) {
        console.error("Failed to load attachment details:", err);
        onShowNotice("Failed to load attachment metadata");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [attachmentId, onShowNotice]);

  const copyHashToClipboard = () => {
    if (details?.sha256_hash) {
      navigator.clipboard.writeText(details.sha256_hash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
      onShowNotice("SHA-256 hash copied to clipboard");
    }
  };

  return (
    <div
      className="overlay-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Attachment Details"
    >
      <div className="attachment-details-modal">
        <div className="details-header">
          <h3 className="details-title">Document Storage & Integrity</h3>
          <button type="button" className="card-close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        {isLoading ? (
          <div className="details-loading">Verifying cryptographic hash on disk...</div>
        ) : details ? (
          <div className="details-body">
            <div className="details-field">
              <span className="details-label">Original Filename</span>
              <span className="details-value-strong">{details.file_name}</span>
            </div>

            <div className="details-field">
              <span className="details-label">Integrity Status</span>
              <div className="integrity-status-pill">
                {!details.file_exists ? (
                  <span className="status-badge error">⚠ File missing from disk</span>
                ) : details.integrity_ok ? (
                  <span className="status-badge success">✓ SHA-256 Verified Intact</span>
                ) : (
                  <span className="status-badge warning">⚠ Checksum Mismatch (Corrupted)</span>
                )}
              </div>
            </div>

            <div className="details-field">
              <span className="details-label">Cryptographic Checksum (SHA-256)</span>
              <div className="hash-row">
                <code className="details-hash-code">{details.sha256_hash}</code>
                <button
                  type="button"
                  className="hash-copy-btn"
                  onClick={copyHashToClipboard}
                  title="Copy SHA-256 Hash"
                >
                  {copiedHash ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="details-field">
              <span className="details-label">Relative Managed Storage Path</span>
              <code className="details-storage-path">{details.storage_path}</code>
            </div>

            <div className="details-grid-row">
              <div className="details-field">
                <span className="details-label">File Size</span>
                <span className="details-value">
                  {formatFileSize(details.file_size)} ({details.file_size.toLocaleString()} bytes)
                </span>
              </div>

              <div className="details-field">
                <span className="details-label">MIME Type</span>
                <span className="details-value">{details.mime_type}</span>
              </div>
            </div>

            <div className="details-grid-row">
              <div className="details-field">
                <span className="details-label">Import Timestamp</span>
                <span className="details-value">
                  {new Date(details.created_at).toLocaleString()}
                </span>
              </div>

              <div className="details-field">
                <span className="details-label">Referencing Notes</span>
                <span className="details-value">
                  {details.associated_records.length} {details.associated_records.length === 1 ? "note" : "notes"}
                </span>
              </div>
            </div>

            <div className="details-footer">
              <button
                type="button"
                className="desk-btn secondary"
                onClick={() => api.openAttachmentInSystem(details.id)}
              >
                Open in System ↗
              </button>
              <button type="button" className="desk-btn primary" onClick={onClose}>
                Dismiss
              </button>
            </div>
          </div>
        ) : (
          <div className="details-error">Attachment information not found.</div>
        )}
      </div>
    </div>
  );
};
