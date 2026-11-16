import { FC, useState, useEffect } from "react";
import { AttachmentSummary, getViewerType, formatFileSize } from "./types";
import * as api from "./attachmentsApi";

interface DocumentPreviewModalProps {
  attachment: AttachmentSummary;
  onClose: () => void;
  onShowNotice: (msg: string) => void;
}

export const DocumentPreviewModal: FC<DocumentPreviewModalProps> = ({
  attachment,
  onClose,
  onShowNotice,
}) => {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const viewerType = getViewerType(attachment.mime_type, attachment.file_name);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setLoadError(null);

    async function loadData() {
      try {
        if (viewerType === "markdown" || viewerType === "text") {
          const text = await api.readAttachmentText(attachment.id);
          if (isMounted) setTextContent(text);
        } else if (viewerType === "image" || viewerType === "pdf") {
          const url = await api.readAttachmentDataUrl(attachment.id);
          if (isMounted) setDataUrl(url);
        }
      } catch (err: any) {
        console.error("[DocumentPreviewModal] Error loading attachment preview:", err);
        if (isMounted) {
          setLoadError(err?.message || "Failed to load document content from storage.");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [attachment.id, viewerType]);

  const handleOpenInSystem = async () => {
    try {
      await api.openAttachmentInSystem(attachment.id);
      onShowNotice("Opened document in default system application.");
    } catch (err: any) {
      console.error("[DocumentPreviewModal] Open in system error:", err);
      onShowNotice(`Failed to open file: ${err?.message || err}`);
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
      aria-label={`Preview: ${attachment.file_name}`}
    >
      <div className="preview-modal-container">
        {/* Modal Header */}
        <div className="preview-header">
          <div className="preview-title-block">
            <span className={`preview-badge type-${viewerType}`}>
              {viewerType.toUpperCase()}
            </span>
            <h2 className="preview-filename">{attachment.file_name}</h2>
            <span className="preview-meta-size">{formatFileSize(attachment.file_size)}</span>
          </div>

          <div className="preview-header-actions">
            <button
              type="button"
              className="desk-btn secondary"
              onClick={handleOpenInSystem}
              title="Open with OS default application"
            >
              Open in System ↗
            </button>
            <button
              type="button"
              className="card-close-btn"
              onClick={onClose}
              title="Close preview (Esc)"
            >
              ×
            </button>
          </div>
        </div>

        {/* Modal Body / Viewer Surface */}
        <div className="preview-content-surface">
          {isLoading && (
            <div className="preview-loading-state">
              <div className="loading-spinner" />
              <span>Streaming document from managed storage...</span>
            </div>
          )}

          {!isLoading && loadError && (
            <div className="preview-error-card">
              <div className="error-icon">⚠</div>
              <h3>Document Read Error</h3>
              <p>{loadError}</p>
              <button
                type="button"
                className="desk-btn primary"
                onClick={handleOpenInSystem}
              >
                Attempt Opening with System Application
              </button>
            </div>
          )}

          {!isLoading && !loadError && (
            <>
              {/* PDF Preview */}
              {viewerType === "pdf" && (
                <div className="pdf-viewer-wrapper">
                  {dataUrl ? (
                    <iframe
                      src={dataUrl}
                      title={attachment.file_name}
                      className="pdf-iframe-surface"
                    />
                  ) : (
                    <div className="pdf-fallback-card">
                      <div className="pdf-icon">📄</div>
                      <h3>PDF Research Document</h3>
                      <p>
                        This document is safely preserved in managed storage. Open it in your
                        dedicated system reader for complete annotation and highlight workflows.
                      </p>
                      <button
                        type="button"
                        className="desk-btn primary"
                        onClick={handleOpenInSystem}
                      >
                        Open in System PDF Reader →
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Markdown Preview */}
              {viewerType === "markdown" && (
                <div className="markdown-viewer-wrapper">
                  <div className="markdown-reading-document">
                    <pre className="markdown-rendered-prose">{textContent}</pre>
                  </div>
                </div>
              )}

              {/* Plain Text Preview */}
              {viewerType === "text" && (
                <div className="text-viewer-wrapper">
                  <pre className="text-plain-surface">{textContent}</pre>
                </div>
              )}

              {/* Image Preview */}
              {viewerType === "image" && (
                <div className="image-viewer-wrapper">
                  {dataUrl ? (
                    <img
                      src={dataUrl}
                      alt={attachment.file_name}
                      className="image-preview-target"
                    />
                  ) : (
                    <div>Unable to render image preview.</div>
                  )}
                </div>
              )}

              {/* Generic File Format Fallback */}
              {viewerType === "generic" && (
                <div className="generic-format-card">
                  <div className="generic-format-icon">📁</div>
                  <h3 className="generic-filename">{attachment.file_name}</h3>
                  <div className="generic-meta-row">
                    <span>MIME: {attachment.mime_type}</span>
                    <span>Size: {formatFileSize(attachment.file_size)}</span>
                  </div>
                  <p className="generic-explanation">
                    This file is stored in content-addressed managed storage. Its cryptographic
                    checksum and original contents are fully preserved.
                  </p>
                  <button
                    type="button"
                    className="desk-btn primary"
                    onClick={handleOpenInSystem}
                  >
                    Open with System Application →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
