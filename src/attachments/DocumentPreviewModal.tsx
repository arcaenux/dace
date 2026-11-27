import { FC, useState, useEffect, useRef } from "react";
import { AttachmentSummary, getViewerType, formatFileSize } from "./types";
import * as api from "./attachmentsApi";
import { useDismissable } from "../core/useDismissable";

interface DocumentPreviewModalProps {
  attachment: AttachmentSummary;
  onClose: () => void;
  onShowNotice: (msg: string) => void;
}

/** Turn a base64 data: URL into a revocable blob: URL (no network fetch). */
function dataUrlToObjectUrl(url: string): string {
  if (!url.startsWith("data:")) return url;
  const comma = url.indexOf(",");
  const meta = url.slice(5, comma);
  const mime = meta.split(";")[0] || "application/octet-stream";
  const payload = url.slice(comma + 1);
  let bytes: Uint8Array<ArrayBuffer>;
  if (meta.includes(";base64")) {
    const binary = atob(payload);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  } else {
    bytes = new Uint8Array(new TextEncoder().encode(decodeURIComponent(payload)));
  }
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

export const DocumentPreviewModal: FC<DocumentPreviewModalProps> = ({
  attachment,
  onClose,
  onShowNotice,
}) => {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (dataUrl?.startsWith("blob:")) URL.revokeObjectURL(dataUrl);
    };
  }, [dataUrl]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useDismissable(true, onClose, modalRef, {
    group: "attachment-dialog",
    autoFocus: true,
    restoreFocus: true,
  });

  const viewerType = getViewerType(attachment.mime_type, attachment.file_name);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setLoadError(null);
    setTextContent(null);
    setDataUrl(null);

    async function loadData() {
      try {
        if (viewerType === "markdown" || viewerType === "text") {
          const text = await api.readAttachmentText(attachment.id);
          if (isMounted) setTextContent(text);
        } else if (viewerType === "image" || viewerType === "pdf") {
          const url = await api.readAttachmentDataUrl(attachment.id);
          // Frames may only load blob: URLs under the app's CSP, so PDFs are
          // handed over as a local object URL instead of a data: URL.
          const shown = viewerType === "pdf" ? dataUrlToObjectUrl(url) : url;
          if (isMounted) {
            setDataUrl(shown);
          } else if (shown.startsWith("blob:")) {
            URL.revokeObjectURL(shown);
          }
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
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${attachment.file_name}`}
    >
      <div ref={modalRef} className="preview-modal-container">
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
