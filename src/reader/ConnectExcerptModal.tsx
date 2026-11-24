import { FC, useState, useEffect, useRef } from "react";
import { Highlight } from "./types.ts";
import { useDismissable } from "../core/useDismissable";
import * as readerApi from "./readerApi.ts";
import { listRecords } from "../knowledge/knowledgeApi.ts";
import { KnowledgeRecordSummary } from "../knowledge/types.ts";

interface ConnectExcerptModalProps {
  highlight: Highlight;
  documentTitle: string;
  onClose: () => void;
  onRecordCreated?: (recordId: string) => void;
  onShowNotice: (msg: string) => void;
}

export const ConnectExcerptModal: FC<ConnectExcerptModalProps> = ({
  highlight,
  documentTitle,
  onClose,
  onRecordCreated,
  onShowNotice,
}) => {
  const [mode, setMode] = useState<"create" | "link">("create");
  const [recordTitle, setRecordTitle] = useState<string>(
    `Insight from ${documentTitle} (p. ${highlight.page_number})`
  );
  const [commentary, setCommentary] = useState<string>(
    highlight.annotation?.content || ""
  );

  // Link mode state
  const [existingRecords, setExistingRecords] = useState<KnowledgeRecordSummary[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useDismissable(
    true,
    () => {
      if (!isSubmitting) onClose();
    },
    modalRef,
    { group: "reader-dialog", autoFocus: true }
  );

  useEffect(() => {
    let cancelled = false;
    async function fetchRecords() {
      try {
        const records = await listRecords();
        if (cancelled) return;
        setExistingRecords(records);
        if (records.length > 0) {
          setSelectedRecordId((current) => current || records[0].id);
        }
      } catch (err) {
        if (!cancelled) console.error("Failed to load records for linking:", err);
      }
    }
    void fetchRecords();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreateRecord = async () => {
    if (!recordTitle.trim()) {
      onShowNotice("Please provide a title for the knowledge record");
      return;
    }

    setIsSubmitting(true);
    try {
      const newRecord = await readerApi.createRecordFromExcerpt(
        highlight.id,
        recordTitle.trim(),
        commentary.trim() || null
      );
      onShowNotice(`Created knowledge record "${newRecord.title}" connected to excerpt`);
      onClose();
      if (onRecordCreated) {
        onRecordCreated(newRecord.id);
      }
    } catch (err: any) {
      console.error("Failed to create record from excerpt:", err);
      onShowNotice(`Failed to create record: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLinkRecord = async () => {
    if (!effectiveSelectedRecordId) {
      onShowNotice("Please select a knowledge record to connect");
      return;
    }

    setIsSubmitting(true);
    try {
      await readerApi.linkHighlightToRecord(
        highlight.id,
        effectiveSelectedRecordId,
        commentary.trim() || null
      );
      onShowNotice("Excerpt connected to selected knowledge record");
      onClose();
    } catch (err: any) {
      console.error("Failed to link highlight to record:", err);
      onShowNotice(`Failed to connect: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredRecords = existingRecords.filter((r) =>
    r.title.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const effectiveSelectedRecordId = filteredRecords.some((r) => r.id === selectedRecordId)
    ? selectedRecordId
    : (filteredRecords[0]?.id ?? "");
  const canLinkSelectedRecord = effectiveSelectedRecordId !== "";

  return (
    <div
      className="overlay-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Connect Excerpt to Knowledge"
    >
      <div ref={modalRef} className="attachment-details-modal" style={{ maxWidth: "580px", maxHeight: "min(88vh, 720px)", display: "flex", flexDirection: "column" }}>
        <div className="details-modal-header">
          <div>
            <span className="details-modal-badge">Knowledge Crystallization</span>
            <h2 className="details-modal-title">Connect Excerpt to Knowledge</h2>
          </div>
          <button
            className="details-modal-close-btn"
            onClick={() => { if (!isSubmitting) onClose(); }}
            aria-label="Close"
            data-overlay-initial-focus
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="details-modal-body" style={{ overflowY: "auto", minHeight: 0 }}>
          {/* Exact Quoted Passage Preview */}
          <div style={{ marginBottom: "16px" }}>
            <span className="detail-meta-label">Selected Passage</span>
            <div className="card-quote" style={{ marginTop: "6px", fontSize: "1rem" }}>
              "{highlight.selected_text}"
            </div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-dim)", marginTop: "4px" }}>
              Source: <em>{documentTitle}</em>, page {highlight.page_number}
            </div>
          </div>

          {/* Mode Switcher */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            <button
              className={`activity-back-btn ${mode === "create" ? "active" : ""}`}
              style={{
                background: mode === "create" ? "var(--accent-muted)" : "var(--bg-surface-subtle)",
                borderColor: mode === "create" ? "var(--accent-primary)" : "var(--border-subtle)",
                color: mode === "create" ? "var(--text-primary)" : "var(--text-dim)",
              }}
              onClick={() => setMode("create")}
            >
              Create New Knowledge Record
            </button>
            <button
              className={`activity-back-btn ${mode === "link" ? "active" : ""}`}
              style={{
                background: mode === "link" ? "var(--accent-muted)" : "var(--bg-surface-subtle)",
                borderColor: mode === "link" ? "var(--accent-primary)" : "var(--border-subtle)",
                color: mode === "link" ? "var(--text-primary)" : "var(--text-dim)",
              }}
              onClick={() => setMode("link")}
            >
              Link to Existing Record
            </button>
          </div>

          {mode === "create" ? (
            <div>
              <div style={{ marginBottom: "12px" }}>
                <label className="detail-meta-label" style={{ display: "block", marginBottom: "4px" }}>
                  Record Title
                </label>
                <input
                  type="text"
                  className="card-note-edit"
                  style={{ minHeight: "36px", padding: "6px 10px" }}
                  value={recordTitle}
                  onChange={(e) => setRecordTitle(e.target.value)}
                  placeholder="Conceptual title..."
                />
              </div>

              <div>
                <label className="detail-meta-label" style={{ display: "block", marginBottom: "4px" }}>
                  Reflective Commentary & Analysis (Optional)
                </label>
                <textarea
                  className="card-note-edit"
                  value={commentary}
                  onChange={(e) => setCommentary(e.target.value)}
                  placeholder="Why is this insight significant? How does it connect to your thesis?"
                  rows={4}
                />
              </div>
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: "12px" }}>
                <label className="detail-meta-label" style={{ display: "block", marginBottom: "4px" }}>
                  Search Knowledge Records
                </label>
                <input
                  type="text"
                  className="card-note-edit"
                  style={{ minHeight: "36px", padding: "6px 10px" }}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by title..."
                />
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label className="detail-meta-label" style={{ display: "block", marginBottom: "4px" }}>
                  Select Target Record
                </label>
                <select
                  className="card-note-edit"
                  style={{ minHeight: "36px", padding: "6px 8px" }}
                  value={effectiveSelectedRecordId}
                  onChange={(e) => setSelectedRecordId(e.target.value)}
                >
                  {filteredRecords.length === 0 ? (
                    <option value="">No records found</option>
                  ) : (
                    filteredRecords.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="detail-meta-label" style={{ display: "block", marginBottom: "4px" }}>
                  Connection Context / Commentary (Optional)
                </label>
                <textarea
                  className="card-note-edit"
                  value={commentary}
                  onChange={(e) => setCommentary(e.target.value)}
                  placeholder="Explain the relationship between this excerpt and the concept..."
                  rows={3}
                />
              </div>
            </div>
          )}
        </div>

        <div className="details-modal-footer">
          <button className="details-action-btn" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          {mode === "create" ? (
            <button
              className="details-action-btn primary"
              onClick={handleCreateRecord}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Creating..." : "Create Record & Connect"}
            </button>
          ) : (
            <button
              className="details-action-btn primary"
              onClick={handleLinkRecord}
              disabled={isSubmitting || !canLinkSelectedRecord}
            >
              {isSubmitting ? "Connecting..." : "Link Excerpt"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
