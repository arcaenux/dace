import {
  FC,
  RefObject,
  memo,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  Check,
  ChevronRight,
  Heading2,
  Link2,
  List,
  ListChecks,
  Quote,
  Tag,
  X,
} from "lucide-react";
import { Highlight, OutlineItem } from "./types.ts";
import { AttachmentSummary } from "../attachments/types.ts";
import * as readerApi from "./readerApi.ts";
import * as attachmentsApi from "../attachments/attachmentsApi.ts";
import * as knowledgeApi from "../knowledge/knowledgeApi.ts";
import { KnowledgeGraphView } from "../graph/KnowledgeGraphView.tsx";
import { NoteExcerpt } from "./noteExcerpts.ts";
import { ReaderNoteSaveStatus } from "./useReaderNote.ts";

type ReaderDrawerTab = "highlights" | "outline" | "knowledge" | "info";

interface ReaderDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: ReaderDrawerTab;
  onTabChange: (tab: ReaderDrawerTab) => void;
  highlights: Highlight[];
  outline: OutlineItem[];
  attachment: AttachmentSummary;
  selectedHighlightId: string | null;
  onSelectHighlight: (id: string) => void;
  onJumpToPage: (page: number, attachmentId?: string) => void;
  onOpenConnectModal: (highlight: Highlight) => void;
  onHighlightDeleted: (id: string) => void;
  onHighlightUpdated: (updated: Highlight) => void;
  onNavigateToRecord?: (recordId: string) => void;
  onShowNotice: (msg: string) => void;
  hasNote: boolean;
  noteTitle: string;
  noteContent: string;
  noteTags: string[];
  noteSaveStatus: ReaderNoteSaveStatus;
  noteError: string | null;
  noteExcerpts: NoteExcerpt[];
  noteContentRef: RefObject<HTMLTextAreaElement | null>;
  annotationRequestId?: string | null;
  initialScrollTop?: number;
  onScrollTopChange?: (top: number) => void;
  onStartNote: () => void;
  onNoteTitleChange: (title: string) => void;
  onNoteContentChange: (content: string) => void;
  onNoteTagsChange: (tags: string[]) => void;
  onSaveNote: () => void;
  onDeleteNote: () => Promise<boolean>;
  onInsertMarkdown: (prefix: string, suffix?: string) => void;
  onDeleteDocument: (attachmentId: string) => Promise<boolean>;
}

interface NoteEditorProps {
  hasNote: boolean;
  noteTitle: string;
  noteContent: string;
  noteTags: string[];
  noteSaveStatus: ReaderNoteSaveStatus;
  noteError: string | null;
  noteExcerpts: NoteExcerpt[];
  noteContentRef: RefObject<HTMLTextAreaElement | null>;
  onStartNote: () => void;
  onNoteTitleChange: (title: string) => void;
  onNoteContentChange: (content: string) => void;
  onNoteTagsChange: (tags: string[]) => void;
  onSaveNote: () => void;
  onDeleteNote: () => Promise<boolean>;
  onInsertMarkdown: (prefix: string, suffix?: string) => void;
  onJumpToPage: (page: number, attachmentId?: string) => void;
}

interface HighlightsPanelProps {
  highlights: Highlight[];
  selectedHighlightId: string | null;
  annotationRequestId?: string | null;
  onSelectHighlight: (id: string) => void;
  onJumpToPage: (page: number, attachmentId?: string) => void;
  onOpenConnectModal: (highlight: Highlight) => void;
  onHighlightDeleted: (id: string) => void;
  onHighlightUpdated: (updated: Highlight) => void;
  onShowNotice: (msg: string) => void;
}

const TABS: { id: ReaderDrawerTab; label: string; icon: typeof BookOpen }[] = [
  { id: "highlights", label: "Notes", icon: BookOpen },
  { id: "outline", label: "Outline", icon: List },
  { id: "knowledge", label: "Knowledge", icon: Link2 },
  { id: "info", label: "Info", icon: Heading2 },
];

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const saveStatusLabel = (status: ReaderNoteSaveStatus, error: string | null) => {
  if (status === "saving") return "Saving…";
  if (status === "unsaved") return "Unsaved";
  if (status === "saved") return "Saved";
  if (status === "error") return error || "Save failed";
  return "Not started";
};

/** Isolated so long-note keystrokes never re-render the highlights list. */
const NoteEditor = memo(function NoteEditor({
  hasNote,
  noteTitle,
  noteContent,
  noteTags,
  noteSaveStatus,
  noteError,
  noteExcerpts,
  noteContentRef,
  onStartNote,
  onNoteTitleChange,
  onNoteContentChange,
  onNoteTagsChange,
  onSaveNote,
  onDeleteNote,
  onInsertMarkdown,
  onJumpToPage,
}: NoteEditorProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const handleDeleteNote = async () => {
    const deleted = await onDeleteNote();
    if (deleted) setIsConfirmingDelete(false);
  };

  if (!hasNote) {
    return (
      <div className="reader-notes-view">
        <div className="reader-note-empty-compact">
          <div className="reader-note-empty-copy">
            <h2>Research note</h2>
            <p>Start a note to capture synthesis and linked source excerpts.</p>
          </div>
          <button className="reader-primary-btn" onClick={onStartNote}>
            Start note
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="reader-notes-view">
      <div className="reader-note-head">
        <div>
          <span className="reader-section-label">Active research note</span>
          <input
            className="reader-note-title"
            value={noteTitle}
            onChange={(event) => onNoteTitleChange(event.target.value)}
            placeholder="Untitled note"
            aria-label="Note title"
          />
          <label className="reader-note-tags">
            <Tag size={11} strokeWidth={1.8} aria-hidden="true" />
            <input
              value={noteTags.join(", ")}
              onChange={(event) =>
                onNoteTagsChange(
                  event.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                )
              }
              placeholder="Add tags, separated by commas"
              aria-label="Note tags"
            />
          </label>
        </div>
        <div className={`reader-save-status status-${noteSaveStatus}`}>
          <span className="reader-save-dot" />
          {saveStatusLabel(noteSaveStatus, noteError)}
        </div>
      </div>

      <div className="reader-format-bar" aria-label="Note formatting">
        <button onClick={() => onInsertMarkdown("## ")} title="Heading">
          <Heading2 size={13} /> Heading
        </button>
        <button onClick={() => onInsertMarkdown("- ")} title="List item">
          <List size={13} /> List
        </button>
        <button onClick={() => onInsertMarkdown("- [ ] ")} title="Checklist item">
          <ListChecks size={13} /> Task
        </button>
        <button onClick={() => onInsertMarkdown("> ")} title="Quote">
          <Quote size={13} /> Quote
        </button>
        <button onClick={() => onInsertMarkdown("[", "](https://)")} title="Link">
          <Link2 size={13} /> Link
        </button>
      </div>

      {noteExcerpts.length > 0 && (
        <section className="reader-source-passages">
          <span className="reader-section-label">Source passages</span>
          <div className="reader-source-chips">
            {noteExcerpts.map((excerpt) => (
              <button
                key={excerpt.id}
                className="reader-source-chip"
                onClick={() => onJumpToPage(excerpt.page, excerpt.attachmentId)}
                title={excerpt.text}
              >
                <span>p. {excerpt.page}</span>
                <span>{excerpt.text.slice(0, 42)}{excerpt.text.length > 42 ? "…" : ""}</span>
                <ChevronRight size={12} />
              </button>
            ))}
          </div>
        </section>
      )}

      <textarea
        ref={noteContentRef}
        className="reader-note-editor"
        value={noteContent}
        onChange={(event) => onNoteContentChange(event.target.value)}
        placeholder="Write your research notes. Use headings, lists and source references to structure your thinking…"
        aria-label="Note content"
        spellCheck={false}
      />

      <div className="reader-note-footer">
        {isConfirmingDelete ? (
          <>
            <span>Delete this note permanently?</span>
            <div className="reader-inline-actions">
              <button className="card-action-link danger" onClick={() => void handleDeleteNote()}>
                Delete
              </button>
              <button className="card-action-link" onClick={() => setIsConfirmingDelete(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <span>Markdown-style notes · autosaved to Knowledge Desk</span>
            <div className="reader-inline-actions">
              <button
                className="card-action-link danger"
                onClick={() => setIsConfirmingDelete(true)}
              >
                Delete note
              </button>
              <button className="reader-tertiary-btn" onClick={onSaveNote}>
                <Check size={12} /> Save now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

/** Isolated so annotation cards keep their own edit/filter state while writing. */
const HighlightsPanel = memo(function HighlightsPanel({
  highlights,
  selectedHighlightId,
  annotationRequestId = null,
  onSelectHighlight,
  onJumpToPage,
  onOpenConnectModal,
  onHighlightDeleted,
  onHighlightUpdated,
  onShowNotice,
}: HighlightsPanelProps) {
  const [filterType, setFilterType] = useState<string>("all");
  const [editingHighlightId, setEditingHighlightId] = useState<string | null>(null);
  const [editNoteContent, setEditNoteContent] = useState<string>("");
  const [deleteRequest, setDeleteRequest] = useState<{
    id: string;
    kind: "annotation" | "highlight";
  } | null>(null);
  const handledAnnotationRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!annotationRequestId || handledAnnotationRequestRef.current === annotationRequestId) return;
    const highlight = highlights.find((item) => item.id === annotationRequestId);
    if (!highlight) return;
    handledAnnotationRequestRef.current = annotationRequestId;
    setEditingHighlightId(highlight.id);
    setEditNoteContent(highlight.annotation?.content || "");
  }, [annotationRequestId, highlights]);

  const filteredHighlights = highlights.filter((highlight) => {
    if (filterType === "all") return true;
    return highlight.highlight_type === filterType;
  });

  const handleStartEditNote = (highlight: Highlight) => {
    setEditingHighlightId(highlight.id);
    setEditNoteContent(highlight.annotation?.content || "");
  };

  const handleSaveAnnotation = async (highlight: Highlight) => {
    try {
      if (editNoteContent.trim()) {
        const annotation = await readerApi.saveAnnotation(highlight.id, editNoteContent.trim());
        onHighlightUpdated({ ...highlight, annotation });
        onShowNotice("Annotation saved");
      } else {
        await readerApi.deleteAnnotation(highlight.id);
        onHighlightUpdated({ ...highlight, annotation: null });
        onShowNotice("Annotation removed");
      }
      setEditingHighlightId(null);
    } catch (err: any) {
      console.error("Failed to save annotation:", err);
      onShowNotice(`Failed to save note: ${err?.message || err}`);
    }
  };

  const handleConfirmDelete = async (highlight: Highlight) => {
    if (!deleteRequest || deleteRequest.id !== highlight.id) return;
    const kind = deleteRequest.kind;
    try {
      if (kind === "annotation") {
        await readerApi.deleteAnnotation(highlight.id);
        onHighlightUpdated({ ...highlight, annotation: null });
        setEditingHighlightId(null);
        onShowNotice("Annotation removed");
      } else {
        await readerApi.deleteHighlight(highlight.id);
        onHighlightDeleted(highlight.id);
        onShowNotice("Highlight deleted");
      }
    } catch (err: any) {
      console.error(`Failed to delete ${kind}:`, err);
      onShowNotice(`Delete failed: ${err?.message || err}`);
    } finally {
      setDeleteRequest(null);
    }
  };

  return (
    <section className="reader-highlights-section">
      <div className="reader-section-heading">
        <span className="reader-section-label">Passages & annotations</span>
        <span>{highlights.length}</span>
      </div>
      <div className="reader-filter-row">
        {["all", "important", "question", "insight", "definition"].map((type) => (
          <button
            key={type}
            className={`toolbar-hl-btn ${filterType === type ? "active" : ""}`}
            onClick={() => setFilterType(type)}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {filteredHighlights.length === 0 ? (
        <div className="reader-inline-empty">
          No {filterType !== "all" ? filterType : ""} highlights recorded yet.
          <br />
          Select text in the document to highlight or annotate.
        </div>
      ) : (
        filteredHighlights.map((highlight) => (
          <div
            key={highlight.id}
            className={`annotation-card ${selectedHighlightId === highlight.id ? "selected" : ""}`}
            onClick={() => onSelectHighlight(highlight.id)}
          >
            <div className="card-header">
              <span className="card-tag">
                <span className={`hl-dot ${highlight.highlight_type}`} />
                <span style={{ color: "var(--text-bright)" }}>{highlight.highlight_type}</span>
              </span>
              <button
                className="card-page-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onJumpToPage(highlight.page_number);
                }}
                title={`Jump to page ${highlight.page_number}`}
              >
                p. {highlight.page_number}
              </button>
            </div>

            {highlight.is_stale && (
              <div className="card-stale-notice">Anchor from earlier document version (hash mismatch)</div>
            )}

            <div className="card-quote">"{highlight.selected_text}"</div>

            {editingHighlightId === highlight.id ? (
              <div style={{ marginTop: "8px" }} onClick={(event) => event.stopPropagation()}>
                <textarea
                  className="card-note-edit"
                  value={editNoteContent}
                  onChange={(event) => setEditNoteContent(event.target.value)}
                  placeholder="Write your reflection, question, or note…"
                  autoFocus
                />
                <div className="reader-inline-actions">
                  <button className="card-action-link" onClick={() => setEditingHighlightId(null)}>
                    Cancel
                  </button>
                  <button className="card-action-link primary" onClick={() => handleSaveAnnotation(highlight)}>
                    Save
                  </button>
                </div>
              </div>
            ) : (
              highlight.annotation && <div className="card-note-area">{highlight.annotation.content}</div>
            )}

            <div className="card-actions" onClick={(event) => event.stopPropagation()}>
              {deleteRequest?.id === highlight.id ? (
                <div className="reader-inline-actions">
                  <span>Delete {deleteRequest.kind}?</span>
                  <button
                    className="card-action-link danger"
                    onClick={() => void handleConfirmDelete(highlight)}
                  >
                    Confirm
                  </button>
                  <button className="card-action-link" onClick={() => setDeleteRequest(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <button className="card-action-link" onClick={() => handleStartEditNote(highlight)}>
                    {highlight.annotation ? "Edit Note" : "+ Note"}
                  </button>
                  {highlight.annotation && (
                    <button
                      className="card-action-link danger"
                      onClick={() => setDeleteRequest({ id: highlight.id, kind: "annotation" })}
                    >
                      Delete note
                    </button>
                  )}
                  <button className="card-action-link" onClick={() => onOpenConnectModal(highlight)}>
                    Connect
                  </button>
                  <button
                    className="card-action-link danger"
                    onClick={() => setDeleteRequest({ id: highlight.id, kind: "highlight" })}
                  >
                    Delete highlight
                  </button>
                </>
              )}
            </div>
          </div>
        ))
      )}
    </section>
  );
});

export const ReaderDrawer: FC<ReaderDrawerProps> = ({
  isOpen,
  onClose,
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
  hasNote,
  noteTitle,
  noteContent,
  noteTags,
  noteSaveStatus,
  noteError,
  noteExcerpts,
  noteContentRef,
  annotationRequestId = null,
  initialScrollTop = 0,
  onScrollTopChange,
  onStartNote,
  onNoteTitleChange,
  onNoteContentChange,
  onNoteTagsChange,
  onSaveNote,
  onDeleteNote,
  onInsertMarkdown,
  onDeleteDocument,
}) => {
  const [linkedRecords, setLinkedRecords] = useState<Array<{ id: string; title: string }>>([]);
  const [isConfirmingDocumentDelete, setIsConfirmingDocumentDelete] = useState(false);
  const [isLoadingLinkedRecords, setIsLoadingLinkedRecords] = useState(false);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const onScrollTopChangeRef = useRef(onScrollTopChange);
  onScrollTopChangeRef.current = onScrollTopChange;

  useEffect(() => {
    const element = contentScrollRef.current;
    if (!element) return;
    element.scrollTop = initialScrollTop;
    let frame: number | null = null;
    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        onScrollTopChangeRef.current?.(element.scrollTop);
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [attachment.id, initialScrollTop]);

  useEffect(() => {
    let cancelled = false;

    async function loadLinkedRecords() {
      if (!isOpen || activeTab !== "knowledge" || attachment.record_count === 0) {
        if (!cancelled) {
          setLinkedRecords([]);
          setIsLoadingLinkedRecords(false);
        }
        return;
      }

      setIsLoadingLinkedRecords(true);
      try {
        const details = await attachmentsApi.getAttachmentDetails(attachment.id);
        const ids = Array.from(
          new Set((details.associated_records || []).filter((id) => typeof id === "string" && id.trim().length > 0))
        );

        const records = await Promise.all(
          ids.map(async (id) => {
            try {
              const record = await knowledgeApi.getRecord(id);
              return { id, title: record?.title?.trim() || "Untitled Record" };
            } catch {
              return { id, title: "Linked Record" };
            }
          })
        );

        if (!cancelled) {
          setLinkedRecords(records);
        }
      } catch {
        if (!cancelled) {
          setLinkedRecords([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingLinkedRecords(false);
        }
      }
    }

    loadLinkedRecords();
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeTab, attachment.id, attachment.record_count]);

  if (!isOpen) return null;

  return (
    <aside className="reader-drawer" aria-label="Research writing workspace">
      <div className="reader-drawer-tabs">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={`drawer-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => onTabChange(tab.id)}
              data-reader-tab={tab.id}
            >
              <Icon size={12} strokeWidth={1.8} />
              <span>{tab.label}</span>
            </button>
          );
        })}
        <button
          className="drawer-close-btn"
          onClick={onClose}
          aria-label="Return to reading mode"
          title="Return to reading"
        >
          <X size={14} />
        </button>
      </div>

      <div className="reader-drawer-content" ref={contentScrollRef}>
        {activeTab === "highlights" && (
          <>
            <NoteEditor
              hasNote={hasNote}
              noteTitle={noteTitle}
              noteContent={noteContent}
              noteTags={noteTags}
              noteSaveStatus={noteSaveStatus}
              noteError={noteError}
              noteExcerpts={noteExcerpts}
              noteContentRef={noteContentRef}
              onStartNote={onStartNote}
              onNoteTitleChange={onNoteTitleChange}
              onNoteContentChange={onNoteContentChange}
              onNoteTagsChange={onNoteTagsChange}
              onSaveNote={onSaveNote}
              onDeleteNote={onDeleteNote}
              onInsertMarkdown={onInsertMarkdown}
              onJumpToPage={onJumpToPage}
            />
            <HighlightsPanel
              highlights={highlights}
              selectedHighlightId={selectedHighlightId}
              annotationRequestId={annotationRequestId}
              onSelectHighlight={onSelectHighlight}
              onJumpToPage={onJumpToPage}
              onOpenConnectModal={onOpenConnectModal}
              onHighlightDeleted={onHighlightDeleted}
              onHighlightUpdated={onHighlightUpdated}
              onShowNotice={onShowNotice}
            />
          </>
        )}

        {activeTab === "outline" && (
          <div className="reader-outline-view">
            {outline.length === 0 ? (
              <div className="reader-inline-empty">
                No embedded bookmarks or headings detected in this document.
              </div>
            ) : (
              <div className="reader-outline-list">
                {outline.map((item, index) => (
                  <div key={`${item.title}-${index}`} className="reader-outline-group">
                    <button
                      className="reader-outline-item"
                      onClick={() => item.pageNumber && onJumpToPage(item.pageNumber)}
                    >
                      <span>{item.title}</span>
                      {item.pageNumber && <span>p. {item.pageNumber}</span>}
                    </button>
                    {item.items?.map((sub, subIndex) => (
                      <button
                        key={`${sub.title}-${subIndex}`}
                        className="reader-outline-item nested"
                        onClick={() => sub.pageNumber && onJumpToPage(sub.pageNumber)}
                      >
                        <span>{sub.title}</span>
                        {sub.pageNumber && <span>p. {sub.pageNumber}</span>}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "knowledge" && (
          <div className="reader-knowledge-view">
            <p className="reader-view-intro">
              Knowledge records referencing this document or its anchored excerpts:
            </p>
            {attachment.record_count === 0 ? (
              <div className="reader-inline-empty">
                No knowledge records currently reference this document.
                <br />
                Use <strong>Connect</strong> on any passage to create a linked note.
              </div>
            ) : isLoadingLinkedRecords ? (
              <div className="reader-inline-empty">Loading linked records…</div>
            ) : linkedRecords.length === 0 ? (
              <div className="reader-inline-empty">
                No linked knowledge records could be resolved for this document.
              </div>
            ) : (
              <>
                <p className="reader-view-intro">
                  This document is linked to <strong>{linkedRecords.length}</strong> knowledge record
                  {linkedRecords.length === 1 ? "" : "s"}.
                </p>
                <div className="reader-linked-records">
                  {linkedRecords.map((record) => (
                    <button
                      key={record.id}
                      className="reader-linked-record"
                      disabled={!onNavigateToRecord}
                      onClick={() => {
                        if (onNavigateToRecord && record.id.trim()) {
                          onNavigateToRecord(record.id);
                        }
                      }}
                      title={record.title}
                    >
                      <span>{record.title}</span>
                      <ChevronRight size={13} />
                    </button>
                  ))}
                </div>
                <div className="reader-embedded-graph">
                  <span className="reader-section-label">Connected graph</span>
                  <KnowledgeGraphView
                    embedded
                    focusRecordId={linkedRecords[0]?.id ?? null}
                    onOpenRecordInDesk={(recordId) => onNavigateToRecord?.(recordId)}
                    onShowNotice={onShowNotice}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "info" && (
          <div className="reader-info-view">
            <div className="reader-info-row">
              <span className="detail-meta-label">File name</span>
              <span>{attachment.file_name}</span>
            </div>
            <div className="reader-info-row">
              <span className="detail-meta-label">Format / MIME</span>
              <span>{attachment.mime_type}</span>
            </div>
            <div className="reader-info-row">
              <span className="detail-meta-label">File size</span>
              <span>{formatBytes(attachment.file_size)}</span>
            </div>
            <div className="reader-info-row">
              <span className="detail-meta-label">Added</span>
              <span>{new Date(attachment.created_at).toLocaleString()}</span>
            </div>
            <div className="reader-info-row">
              <span className="detail-meta-label">Highlights & excerpts</span>
              <span>{highlights.length} recorded</span>
            </div>
            <div className="reader-info-row">
              <span className="detail-meta-label">SHA-256</span>
              <code>{attachment.sha256_hash}</code>
            </div>
            <div className="reader-note-footer">
              {isConfirmingDocumentDelete ? (
                <>
                  <span>
                    Permanently delete from vault? All linked highlights and annotations will be removed.
                  </span>
                  <div className="reader-inline-actions">
                    <button
                      className="card-action-link danger"
                      onClick={async () => {
                        const deleted = await onDeleteDocument(attachment.id);
                        if (deleted) setIsConfirmingDocumentDelete(false);
                      }}
                    >
                      Delete file
                    </button>
                    <button
                      className="card-action-link"
                      onClick={() => setIsConfirmingDocumentDelete(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span>Manage this imported file</span>
                  <button
                    className="card-action-link danger"
                    onClick={() => setIsConfirmingDocumentDelete(true)}
                  >
                    Delete file from vault
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
