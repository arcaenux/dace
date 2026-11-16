import { FC, useState, useEffect, useCallback } from "react";
import { AttachmentSummary, getViewerType } from "../attachments/types.ts";
import * as attApi from "../attachments/attachmentsApi.ts";
import * as readerApi from "./readerApi.ts";
import { Highlight, OutlineItem } from "./types.ts";
import { PdfViewer } from "./PdfViewer.tsx";
import { MarkdownReader } from "./MarkdownReader.tsx";
import { ReaderDrawer } from "./ReaderDrawer.tsx";
import { ConnectExcerptModal } from "./ConnectExcerptModal.tsx";

interface ResearchReaderViewProps {
  initialAttachmentId?: string | null;
  initialPage?: number | null;
  onNavigateToRecord?: (recordId: string) => void;
  onShowNotice: (msg: string) => void;
}

export const ResearchReaderView: FC<ResearchReaderViewProps> = ({
  initialAttachmentId,
  initialPage = 1,
  onNavigateToRecord,
  onShowNotice,
}) => {
  const [documents, setDocuments] = useState<AttachmentSummary[]>([]);
  const [activeAttachment, setActiveAttachment] = useState<AttachmentSummary | null>(null);
  const [isDocPickerOpen, setIsDocPickerOpen] = useState<boolean>(false);

  // Content state
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Reader state
  const [currentPage, setCurrentPage] = useState<number>(initialPage || 1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [selectedHighlightId, setSelectedHighlightId] = useState<string | null>(null);

  // Layout & Distraction-free state
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(true);
  const [drawerTab, setDrawerTab] = useState<"highlights" | "outline" | "knowledge" | "info">("highlights");
  const [isDistractionFree, setIsDistractionFree] = useState<boolean>(false);

  // Modal state
  const [connectHighlight, setConnectHighlight] = useState<Highlight | null>(null);

  // 1. Fetch available attachments
  const loadDocuments = useCallback(async () => {
    try {
      const list = await attApi.listAllAttachments();
      setDocuments(list);

      if (list.length > 0) {
        if (initialAttachmentId) {
          const matched = list.find((d) => d.id === initialAttachmentId);
          setActiveAttachment(matched || list[0]);
        } else if (!activeAttachment) {
          setActiveAttachment(list[0]);
        }
      } else {
        setIsLoading(false);
      }
    } catch (err) {
      console.error("Failed to list library attachments:", err);
      onShowNotice("Could not load document library");
      setIsLoading(false);
    }
  }, [initialAttachmentId, activeAttachment, onShowNotice]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // 2. Load active attachment content & highlights
  useEffect(() => {
    if (!activeAttachment) return;
    let isMounted = true;
    setIsLoading(true);
    setLoadError(null);
    setDataUrl(null);
    setTextContent(null);
    setSelectedHighlightId(null);

    async function loadContent() {
      try {
        const viewerType = getViewerType(
          activeAttachment!.mime_type,
          activeAttachment!.file_name
        );

        if (viewerType === "markdown" || viewerType === "text") {
          const text = await attApi.readAttachmentText(activeAttachment!.id);
          if (isMounted) setTextContent(text);
        } else {
          // Default to PDF data URL
          const url = await attApi.readAttachmentDataUrl(activeAttachment!.id);
          if (isMounted) setDataUrl(url);
        }

        // Fetch persisted highlights from SQLite
        const hls = await readerApi.getAttachmentHighlights(activeAttachment!.id);
        if (isMounted) setHighlights(hls);
      } catch (err: any) {
        console.error("Failed to load document content:", err);
        if (isMounted) {
          setLoadError(err?.message || "Failed to load document from storage");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadContent();

    return () => {
      isMounted = false;
    };
  }, [activeAttachment]);

  const handlePickAndImport = async () => {
    try {
      const res = await attApi.pickAndImportAttachment();
      if (res) {
        onShowNotice(`Imported "${res.attachment.file_name}"`);
        await loadDocuments();
        setActiveAttachment(res.attachment);
        setIsDocPickerOpen(false);
      }
    } catch (err: any) {
      console.error("Import error:", err);
      onShowNotice(`Import failed: ${err?.message || err}`);
    }
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= totalPages) {
      setCurrentPage(val);
    }
  };

  const viewerType = activeAttachment
    ? getViewerType(activeAttachment.mime_type, activeAttachment.file_name)
    : "pdf";

  return (
    <div className="research-reader-container">
      {/* 1. Header Toolbar */}
      <header className="reader-header">
        <div className="reader-header-left">
          {/* Document Switcher Dropdown */}
          <div style={{ position: "relative" }}>
            <button
              className="reader-doc-select-btn"
              onClick={() => setIsDocPickerOpen(!isDocPickerOpen)}
              title="Switch research document"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
              <span>{activeAttachment ? activeAttachment.file_name : "No Documents"}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>

            {isDocPickerOpen && (
              <div
                className="activity-dropdown"
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: "6px",
                  background: "#0f172a",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "6px",
                  boxShadow: "0 10px 25px rgba(0,0,0,0.7)",
                  width: "280px",
                  zIndex: 200,
                  maxHeight: "300px",
                  overflowY: "auto",
                }}
              >
                <div style={{ padding: "6px" }}>
                  <button
                    className="reader-action-btn"
                    style={{ width: "100%", justifyContent: "center", marginBottom: "6px" }}
                    onClick={handlePickAndImport}
                  >
                    + Import Research Document
                  </button>
                  {documents.length === 0 ? (
                    <div style={{ padding: "8px", fontSize: "0.8rem", color: "var(--text-dim)" }}>
                      No documents in library
                    </div>
                  ) : (
                    documents.map((doc) => (
                      <div
                        key={doc.id}
                        style={{
                          padding: "8px 10px",
                          fontSize: "0.82rem",
                          cursor: "pointer",
                          borderRadius: "4px",
                          background: doc.id === activeAttachment?.id ? "rgba(99, 102, 241, 0.15)" : "transparent",
                          color: doc.id === activeAttachment?.id ? "var(--text-bright)" : "var(--text-normal)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        onClick={() => {
                          setActiveAttachment(doc);
                          setIsDocPickerOpen(false);
                          setCurrentPage(1);
                        }}
                      >
                        {doc.file_name}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center: Page Navigation (for PDF documents) */}
        {viewerType === "pdf" && (
          <div className="reader-header-center">
            <button
              className="reader-nav-btn"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              title="Previous Page (Left Arrow)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>

            <div className="reader-page-indicator">
              <span>Page</span>
              <input
                type="text"
                className="reader-page-input"
                value={currentPage}
                onChange={handlePageInputChange}
              />
              <span>/ {totalPages}</span>
            </div>

            <button
              className="reader-nav-btn"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              title="Next Page (Right Arrow)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>
        )}

        {/* Right Actions: Distraction-free toggle and Drawer toggle */}
        <div className="reader-header-right">
          <button
            className={`reader-action-btn ${isDistractionFree ? "active" : ""}`}
            onClick={() => {
              const next = !isDistractionFree;
              setIsDistractionFree(next);
              if (next) setIsDrawerOpen(false);
            }}
            title="Distraction-Reduced Reading Mode"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h6v6"></path>
              <path d="M9 21H3v-6"></path>
              <path d="M21 3l-7 7"></path>
              <path d="M3 21l7-7"></path>
            </svg>
            <span>{isDistractionFree ? "Exit Focus" : "Focus"}</span>
          </button>

          <button
            className={`reader-action-btn ${isDrawerOpen ? "active" : ""}`}
            onClick={() => setIsDrawerOpen(!isDrawerOpen)}
            title="Toggle Notes & Outline Drawer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="15" y1="3" x2="15" y2="21"></line>
            </svg>
            <span>Sidebar</span>
          </button>
        </div>
      </header>

      {/* 2. Main Workspace Area */}
      <div className="reader-workspace-area">
        {isLoading ? (
          <div className="reader-viewport" style={{ justifyContent: "center" }}>
            <div style={{ color: "var(--text-dim)", fontSize: "0.9rem" }}>Loading document...</div>
          </div>
        ) : loadError ? (
          <div className="reader-viewport" style={{ justifyContent: "center" }}>
            <div style={{ color: "#f87171", fontSize: "0.9rem", textAlign: "center", maxWidth: "480px" }}>
              <strong>Could not load document:</strong>
              <p style={{ marginTop: "6px" }}>{loadError}</p>
            </div>
          </div>
        ) : !activeAttachment ? (
          <div className="reader-viewport" style={{ justifyContent: "center" }}>
            <div style={{ textAlign: "center", maxWidth: "420px" }}>
              <div style={{ fontSize: "1.1rem", color: "var(--text-bright)", marginBottom: "8px" }}>
                No Research Documents in Library
              </div>
              <p style={{ fontSize: "0.85rem", color: "var(--text-dim)", marginBottom: "16px" }}>
                Import a PDF, Markdown paper, or text document into managed storage to begin reading and annotating.
              </p>
              <button className="activity-back-btn" onClick={handlePickAndImport}>
                Import Research Document
              </button>
            </div>
          </div>
        ) : viewerType === "markdown" || viewerType === "text" ? (
          <MarkdownReader
            content={textContent || ""}
            attachmentId={activeAttachment.id}
            documentTitle={activeAttachment.file_name}
            highlights={highlights}
            onHighlightCreated={(newHl) => setHighlights((prev) => [...prev, newHl])}
            onHighlightSelected={(hlId) => {
              setSelectedHighlightId(hlId);
              setIsDrawerOpen(true);
              setDrawerTab("highlights");
            }}
            onRecordCreatedFromExcerpt={(recId) => {
              if (onNavigateToRecord) onNavigateToRecord(recId);
            }}
            onShowNotice={onShowNotice}
            isDistractionFree={isDistractionFree}
          />
        ) : (
          <PdfViewer
            dataUrl={dataUrl || ""}
            attachmentId={activeAttachment.id}
            documentTitle={activeAttachment.file_name}
            highlights={highlights}
            currentPage={currentPage}
            onPageChange={(page) => setCurrentPage(page)}
            onTotalPagesDetected={(total) => setTotalPages(total)}
            onOutlineLoaded={(out) => setOutline(out)}
            onHighlightCreated={(newHl) => setHighlights((prev) => [...prev, newHl])}
            onHighlightSelected={(hlId) => {
              setSelectedHighlightId(hlId);
              setIsDrawerOpen(true);
              setDrawerTab("highlights");
            }}
            onRecordCreatedFromExcerpt={(recId) => {
              if (onNavigateToRecord) onNavigateToRecord(recId);
            }}
            onShowNotice={onShowNotice}
            isDistractionFree={isDistractionFree}
          />
        )}

        {/* 3. Collapsible Sidebar Drawer */}
        {activeAttachment && (
          <ReaderDrawer
            isOpen={isDrawerOpen}
            activeTab={drawerTab}
            onTabChange={(tab) => setDrawerTab(tab)}
            highlights={highlights}
            outline={outline}
            attachment={activeAttachment}
            selectedHighlightId={selectedHighlightId}
            onSelectHighlight={(id) => setSelectedHighlightId(id)}
            onJumpToPage={(p) => setCurrentPage(p)}
            onOpenConnectModal={(hl) => setConnectHighlight(hl)}
            onHighlightDeleted={(id) => {
              setHighlights((prev) => prev.filter((h) => h.id !== id));
            }}
            onHighlightUpdated={(upd) => {
              setHighlights((prev) => prev.map((h) => (h.id === upd.id ? upd : h)));
            }}
            onNavigateToRecord={(recId) => {
              if (onNavigateToRecord) onNavigateToRecord(recId);
            }}
            onShowNotice={onShowNotice}
          />
        )}
        {/* Connect Excerpt Modal from Drawer */}
        {connectHighlight && activeAttachment && (
          <ConnectExcerptModal
            highlight={connectHighlight}
            documentTitle={activeAttachment.file_name}
            onClose={() => setConnectHighlight(null)}
            onRecordCreated={(recId) => {
              if (onNavigateToRecord) onNavigateToRecord(recId);
            }}
            onShowNotice={onShowNotice}
          />
        )}
      </div>
    </div>
  );
};
