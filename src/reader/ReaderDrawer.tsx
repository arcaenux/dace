import { FC, useState } from "react";
import { Highlight, OutlineItem } from "./types.ts";
import { AttachmentSummary } from "../attachments/types.ts";
import * as readerApi from "./readerApi.ts";

interface ReaderDrawerProps {
  isOpen: boolean;
  activeTab: "highlights" | "outline" | "knowledge" | "info";
  onTabChange: (tab: "highlights" | "outline" | "knowledge" | "info") => void;
  highlights: Highlight[];
  outline: OutlineItem[];
  attachment: AttachmentSummary;
  selectedHighlightId: string | null;
  onSelectHighlight: (id: string) => void;
  onJumpToPage: (page: number) => void;
  onOpenConnectModal: (highlight: Highlight) => void;
  onHighlightDeleted: (id: string) => void;
  onHighlightUpdated: (updated: Highlight) => void;
  onNavigateToRecord?: (recordId: string) => void;
  onShowNotice: (msg: string) => void;
}

export const ReaderDrawer: FC<ReaderDrawerProps> = ({
  isOpen,
  activeTab,
  onTabChange,
  highlights,
  outline,
  attachment,
  selectedHighlightId,
  onSelectHighlight,
  onJumpToPage,
  onOpenConnectModal,
  onHighlightDeleted,
  onHighlightUpdated,
  onNavigateToRecord,
  onShowNotice,
}) => {
  const [filterType, setFilterType] = useState<string>("all");
  const [editingHighlightId, setEditingHighlightId] = useState<string | null>(null);
  const [editNoteContent, setEditNoteContent] = useState<string>("");

  if (!isOpen) return null;

  const filteredHighlights = highlights.filter((h) => {
    if (filterType === "all") return true;
    return h.highlight_type === filterType;
  });

  const handleStartEditNote = (hl: Highlight) => {
    setEditingHighlightId(hl.id);
    setEditNoteContent(hl.annotation?.content || "");
  };

  const handleSaveNote = async (hl: Highlight) => {
    try {
      if (editNoteContent.trim()) {
        const ann = await readerApi.saveAnnotation(hl.id, editNoteContent.trim());
        onHighlightUpdated({
          ...hl,
          annotation: ann,
        });
        onShowNotice("Annotation saved");
      } else {
        await readerApi.deleteAnnotation(hl.id);
        onHighlightUpdated({
          ...hl,
          annotation: null,
        });
        onShowNotice("Annotation removed");
      }
      setEditingHighlightId(null);
    } catch (err: any) {
      console.error("Failed to save annotation:", err);
      onShowNotice(`Failed to save note: ${err?.message || err}`);
    }
  };

  const handleDeleteHighlight = async (hlId: string) => {
    try {
      await readerApi.deleteHighlight(hlId);
      onHighlightDeleted(hlId);
      onShowNotice("Highlight deleted");
    } catch (err: any) {
      console.error("Failed to delete highlight:", err);
      onShowNotice(`Delete failed: ${err?.message || err}`);
    }
  };

  return (
    <aside className="reader-drawer" aria-label="Research Reader Sidebar">
      {/* Drawer Tabs */}
      <div className="reader-drawer-tabs">
        <button
          className={`drawer-tab ${activeTab === "highlights" ? "active" : ""}`}
          onClick={() => onTabChange("highlights")}
          title="Highlights & Notes"
        >
          Notes ({highlights.length})
        </button>
        <button
          className={`drawer-tab ${activeTab === "outline" ? "active" : ""}`}
          onClick={() => onTabChange("outline")}
          title="Table of Contents"
        >
          Outline
        </button>
        <button
          className={`drawer-tab ${activeTab === "knowledge" ? "active" : ""}`}
          onClick={() => onTabChange("knowledge")}
          title="Connected Knowledge Records"
        >
          Knowledge
        </button>
        <button
          className={`drawer-tab ${activeTab === "info" ? "active" : ""}`}
          onClick={() => onTabChange("info")}
          title="Document Metadata & Cryptographic Integrity"
        >
          Info
        </button>
      </div>

      <div className="reader-drawer-content">
        {/* Tab 1: Highlights & Notes */}
        {activeTab === "highlights" && (
          <div>
            {/* Filter pills */}
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "12px" }}>
              {["all", "important", "question", "insight", "definition"].map((type) => (
                <button
                  key={type}
                  className={`toolbar-hl-btn ${filterType === type ? "active" : ""}`}
                  style={{
                    background: filterType === type ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.02)",
                    border: "1px solid var(--border-subtle)",
                    fontSize: "0.72rem",
                    padding: "2px 6px",
                  }}
                  onClick={() => setFilterType(type)}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>

            {filteredHighlights.length === 0 ? (
              <div style={{ fontSize: "0.82rem", color: "var(--text-dim)", textAlign: "center", padding: "24px 0" }}>
                No {filterType !== "all" ? filterType : ""} highlights recorded yet.<br />
                Select text in the document to highlight or annotate.
              </div>
            ) : (
              filteredHighlights.map((hl) => (
                <div
                  key={hl.id}
                  className={`annotation-card ${selectedHighlightId === hl.id ? "selected" : ""}`}
                  onClick={() => onSelectHighlight(hl.id)}
                >
                  <div className="card-header">
                    <span className="card-tag">
                      <span className={`hl-dot ${hl.highlight_type}`} />
                      <span style={{ color: "var(--text-bright)" }}>{hl.highlight_type}</span>
                    </span>
                    <button
                      className="card-page-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onJumpToPage(hl.page_number);
                      }}
                      title={`Jump to page ${hl.page_number}`}
                    >
                      p. {hl.page_number}
                    </button>
                  </div>

                  {hl.is_stale && (
                    <div className="card-stale-notice">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                      </svg>
                      Anchor from earlier document version (hash mismatch)
                    </div>
                  )}

                  <div className="card-quote">"{hl.selected_text}"</div>

                  {editingHighlightId === hl.id ? (
                    <div style={{ marginTop: "8px" }} onClick={(e) => e.stopPropagation()}>
                      <textarea
                        className="card-note-edit"
                        value={editNoteContent}
                        onChange={(e) => setEditNoteContent(e.target.value)}
                        placeholder="Write your reflection, question, or note..."
                        autoFocus
                      />
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px", marginTop: "6px" }}>
                        <button
                          className="card-action-link"
                          onClick={() => setEditingHighlightId(null)}
                        >
                          Cancel
                        </button>
                        <button
                          className="card-action-link"
                          style={{ color: "var(--accent-primary)", fontWeight: 600 }}
                          onClick={() => handleSaveNote(hl)}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {hl.annotation && (
                        <div className="card-note-area">
                          {hl.annotation.content}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="card-action-link"
                      onClick={() => handleStartEditNote(hl)}
                    >
                      {hl.annotation ? "Edit Note" : "+ Note"}
                    </button>
                    <button
                      className="card-action-link"
                      onClick={() => onOpenConnectModal(hl)}
                    >
                      Connect
                    </button>
                    <button
                      className="card-action-link danger"
                      onClick={() => handleDeleteHighlight(hl.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab 2: Outline */}
        {activeTab === "outline" && (
          <div>
            {outline.length === 0 ? (
              <div style={{ fontSize: "0.82rem", color: "var(--text-dim)", textAlign: "center", padding: "24px 0" }}>
                No embedded bookmarks or outline detected in this PDF.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {outline.map((item, idx) => (
                  <div key={idx} style={{ padding: "4px 0" }}>
                    <button
                      className="card-page-btn"
                      style={{ textAlign: "left", width: "100%", textDecoration: "none" }}
                      onClick={() => {
                        if (item.pageNumber) onJumpToPage(item.pageNumber);
                      }}
                    >
                      • {item.title} {item.pageNumber ? `(p. ${item.pageNumber})` : ""}
                    </button>
                    {item.items && item.items.length > 0 && (
                      <div style={{ paddingLeft: "14px", marginTop: "4px" }}>
                        {item.items.map((sub, sidx) => (
                          <div key={sidx} style={{ padding: "2px 0" }}>
                            <button
                              className="card-page-btn"
                              style={{ textAlign: "left", width: "100%", textDecoration: "none" }}
                              onClick={() => {
                                if (sub.pageNumber) onJumpToPage(sub.pageNumber);
                              }}
                            >
                              - {sub.title}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Connected Knowledge */}
        {activeTab === "knowledge" && (
          <div>
            <div style={{ fontSize: "0.82rem", color: "var(--text-dim)", marginBottom: "12px" }}>
              Knowledge records referencing this document or its anchored excerpts:
            </div>
            {attachment.record_count === 0 ? (
              <div style={{ fontSize: "0.82rem", color: "var(--text-dim)", textAlign: "center", padding: "24px 0" }}>
                No knowledge records currently reference this document.<br />
                Use <strong>Connect</strong> on any passage to create a linked note.
              </div>
            ) : (
              <div style={{ padding: "8px 0" }}>
                <p style={{ fontSize: "0.84rem", color: "var(--text-normal)" }}>
                  This document is actively linked to <strong>{attachment.record_count}</strong> knowledge record(s).
                </p>
                <div style={{ marginTop: "12px" }}>
                  <button
                    className="activity-back-btn"
                    style={{ width: "100%", textAlign: "center" }}
                    onClick={() => {
                      if (onNavigateToRecord) onNavigateToRecord("");
                    }}
                  >
                    Open in Knowledge Desk
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Info & Integrity */}
        {activeTab === "info" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "0.82rem" }}>
            <div>
              <span className="detail-meta-label">File Name</span>
              <div style={{ color: "var(--text-bright)", wordBreak: "break-all", marginTop: "2px" }}>
                {attachment.file_name}
              </div>
            </div>

            <div>
              <span className="detail-meta-label">Format / MIME</span>
              <div style={{ color: "var(--text-dim)", marginTop: "2px" }}>{attachment.mime_type}</div>
            </div>

            <div>
              <span className="detail-meta-label">SHA-256 Checksum</span>
              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: "0.72rem",
                  color: "#94a3b8",
                  background: "rgba(0,0,0,0.3)",
                  padding: "6px 8px",
                  borderRadius: "4px",
                  wordBreak: "break-all",
                  marginTop: "2px",
                }}
              >
                {attachment.sha256_hash}
              </div>
            </div>

            <div>
              <span className="detail-meta-label">Total Highlights & Excerpts</span>
              <div style={{ color: "var(--text-bright)", marginTop: "2px" }}>
                {highlights.length} recorded
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
