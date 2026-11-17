import {
  FC,
  useState,
  useEffect,
  useCallback,
  DragEvent as ReactDragEvent,
} from "react";
import { AttachmentSummary, formatFileSize, getViewerType } from "./types";
import * as api from "./attachmentsApi";
import { DocumentPreviewModal } from "./DocumentPreviewModal";
import { AttachmentDetailsModal } from "./AttachmentDetailsModal";

interface RecordAttachmentsPanelProps {
  recordId: string;
  onShowNotice: (msg: string) => void;
  onOpenInReader?: (attachmentId: string, pageNumber: number) => void;
}

export const RecordAttachmentsPanel: FC<RecordAttachmentsPanelProps> = ({
  recordId,
  onShowNotice,
  onOpenInReader,
}) => {
  const [attachments, setAttachments] = useState<AttachmentSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);

  // Modals state
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentSummary | null>(null);
  const [detailsAttachmentId, setDetailsAttachmentId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const loadAttachments = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await api.getRecordAttachments(recordId);
      setAttachments(list);
    } catch (err) {
      console.error("[RecordAttachmentsPanel] Error loading attachments:", err);
      onShowNotice("Failed to load attachments");
    } finally {
      setIsLoading(false);
    }
  }, [recordId, onShowNotice]);

  useEffect(() => {
    loadAttachments();
  }, [loadAttachments]);

  // Handle native file picker import
  const handlePickAndImport = async () => {
    try {
      const result = await api.pickAndImportAttachment(recordId);
      if (result) {
        if (result.is_duplicate) {
          onShowNotice(`Imported "${result.attachment.file_name}" (deduplicated: already in vault)`);
        } else {
          onShowNotice(`Imported and preserved "${result.attachment.file_name}" in managed storage`);
        }
        await loadAttachments();
      }
    } catch (err: any) {
      console.error("[RecordAttachmentsPanel] Import error:", err);
      onShowNotice(`Import failed: ${err?.message || err}`);
    }
  };

  // Handle Drag & Drop file ingestion
  const handleDragOver = (e: ReactDragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: ReactDragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = async (e: ReactDragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const buffer = await file.arrayBuffer();
        const uint8 = new Uint8Array(buffer);
        const res = await api.importAttachmentFromBytes(file.name, uint8, recordId);
        if (res.is_duplicate) {
          onShowNotice(`"${file.name}" linked (identical file already in storage)`);
        } else {
          onShowNotice(`Imported and stored "${file.name}"`);
        }
      } catch (err: any) {
        console.error("Failed importing dropped file:", err);
        onShowNotice(`Could not import "${file.name}": ${err?.message || err}`);
      }
    }
    await loadAttachments();
  };

  // Disassociate from this note
  const handleDisassociate = async (attachmentId: string) => {
    try {
      await api.disassociateAttachmentFromRecord(recordId, attachmentId);
      onShowNotice("Document disassociated from note. (File remains in vault storage)");
      await loadAttachments();
    } catch (err) {
      console.error("Failed to disassociate attachment:", err);
      onShowNotice("Failed to remove attachment link");
    }
  };

  // Permanently delete from storage
  const handlePermanentDelete = async (attachmentId: string) => {
    try {
      await api.deleteAttachment(attachmentId);
      setDeleteConfirmId(null);
      onShowNotice("Managed document permanently purged from storage");
      await loadAttachments();
    } catch (err) {
      console.error("Failed to permanently delete attachment:", err);
      onShowNotice("Failed to delete attachment file");
    }
  };

  return (
    <div
      className={`record-attachments-section ${isDraggingOver ? "drag-target-active" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="attachments-header">
        <div className="attachments-title-wrap">
          <span className="attachments-heading">Managed Research Documents</span>
          <span className="attachments-counter">{attachments.length}</span>
        </div>

        <div className="attachments-actions">
          <button
            type="button"
            className="desk-btn primary add-attachment-btn"
            onClick={handlePickAndImport}
            title="Import an external document into managed storage"
          >
            + Import Document
          </button>
        </div>
      </div>

      {/* Drag & Drop Overlay Callout */}
      {isDraggingOver && (
        <div className="drag-drop-banner">
          <span>Release to import document into managed storage</span>
        </div>
      )}

      {/* Attachments List */}
      <div className="attachments-list-container">
        {isLoading && attachments.length === 0 ? (
          <div className="attachments-loading-text">Loading documents...</div>
        ) : attachments.length === 0 ? (
          <div className="attachments-empty-state">
            <span className="empty-paperclip-icon">📎</span>
            <p className="empty-desc">
              No documents associated with this concept. Import PDFs, research papers, notes, or
              images to preserve them in content-addressed storage.
            </p>
            <button
              type="button"
              className="desk-btn secondary"
              onClick={handlePickAndImport}
            >
              Select File to Import
            </button>
          </div>
        ) : (
          <div className="attachments-grid">
            {attachments.map((att) => {
              const type = getViewerType(att.mime_type, att.file_name);
              return (
                <div key={att.id} className="attachment-card">
                  <div className="attachment-card-top">
                    <span className={`file-type-pill type-${type}`}>
                      {type.toUpperCase()}
                    </span>

                    {!att.file_exists && (
                      <span className="file-missing-badge" title="Physical file missing from storage directory">
                        Missing
                      </span>
                    )}

                    <div className="card-top-buttons">
                      <button
                        type="button"
                        className="icon-action-btn"
                        onClick={() => setDetailsAttachmentId(att.id)}
                        title="Inspect storage path & SHA-256 hash"
                      >
                        ⓘ
                      </button>
                      <button
                        type="button"
                        className="icon-action-btn"
                        onClick={() => handleDisassociate(att.id)}
                        title="Remove association from this note (preserves file in storage)"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  <div
                    className="attachment-filename"
                    onClick={() => setPreviewAttachment(att)}
                    title={`Preview ${att.file_name}`}
                  >
                    {att.file_name}
                  </div>

                  <div className="attachment-meta-row">
                    <span className="file-size">{formatFileSize(att.file_size)}</span>
                    <span className="file-date">
                      {new Date(att.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="attachment-card-actions">
                    {onOpenInReader && (
                      <button
                        type="button"
                        className="desk-btn primary"
                        onClick={() => onOpenInReader(att.id, 1)}
                        title="Read and annotate document in Research Reader"
                      >
                        Read
                      </button>
                    )}
                    <button
                      type="button"
                      className="desk-btn"
                      onClick={() => setPreviewAttachment(att)}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      className="desk-btn secondary"
                      onClick={() => api.openAttachmentInSystem(att.id)}
                      title="Open in system default application"
                    >
                      Open ↗
                    </button>
                  </div>

                  <div className="attachment-card-footer">
                    {deleteConfirmId === att.id ? (
                      <div className="delete-confirm-box">
                        <span className="confirm-warn-text">Permanently delete from disk?</span>
                        <div className="confirm-btns">
                          <button
                            type="button"
                            className="desk-btn danger-confirm"
                            onClick={() => handlePermanentDelete(att.id)}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            className="desk-btn"
                            onClick={() => setDeleteConfirmId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="purge-file-link"
                        onClick={() => setDeleteConfirmId(att.id)}
                        title="Permanently remove file from managed storage"
                      >
                        Delete from Storage
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* In-app Document Preview Modal */}
      {previewAttachment && (
        <DocumentPreviewModal
          attachment={previewAttachment}
          onClose={() => setPreviewAttachment(null)}
          onShowNotice={onShowNotice}
        />
      )}

      {/* Cryptographic Details & Integrity Modal */}
      {detailsAttachmentId && (
        <AttachmentDetailsModal
          attachmentId={detailsAttachmentId}
          onClose={() => setDetailsAttachmentId(null)}
          onShowNotice={onShowNotice}
        />
      )}
    </div>
  );
};
