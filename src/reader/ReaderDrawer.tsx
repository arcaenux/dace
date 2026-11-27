import {
  FC,
  RefObject,
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronRight,
  Hash,
  Highlighter,
  Info,
  Link2,
  ListTree,
  MessageSquarePlus,
  MoreHorizontal,
  PenLine,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useDismissable } from "../core/useDismissable";
import { RichTextEditor, type RichTextEditorHandle } from "../editor/RichTextEditor.tsx";
import { Highlight, OutlineItem } from "./types.ts";
import { AttachmentSummary } from "../attachments/types.ts";
import * as readerApi from "./readerApi.ts";
import * as attachmentsApi from "../attachments/attachmentsApi.ts";
import * as knowledgeApi from "../knowledge/knowledgeApi.ts";
import { KnowledgeGraphView } from "../graph/KnowledgeGraphView.tsx";
import { NoteExcerpt } from "./noteExcerpts.ts";
import { ReaderNoteSaveStatus } from "./useReaderNote.ts";

import type { ReaderDrawerTab } from "./readerSession.ts";

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

/** One tool at a time; "highlights" is the note page (kept for saved sessions). */
const DRAWER_VIEWS: { id: ReaderDrawerTab; label: string; icon: LucideIcon }[] = [
  { id: "highlights", label: "Note", icon: PenLine },
  { id: "passages", label: "Passages", icon: Highlighter },
  { id: "outline", label: "Outline", icon: ListTree },
  { id: "knowledge", label: "Links", icon: Link2 },
  { id: "info", label: "Info", icon: Info },
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
  onStartNote,
  onNoteTitleChange,
  onNoteContentChange,
  onNoteTagsChange,
  onSaveNote,
  onDeleteNote,
  onJumpToPage,
}: NoteEditorProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  useDismissable(isMenuOpen, () => {
    setIsMenuOpen(false);
    setIsConfirmingDelete(false);
  }, menuRef, { triggerRef: menuTriggerRef, group: "reader-popover" });

  const bodyRef = useRef<RichTextEditorHandle>(null);

  // Long titles (e.g. "Notes — <paper name>") wrap instead of being cut off.
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    title.style.height = "auto";
    title.style.height = `${title.scrollHeight}px`;
  }, [noteTitle, hasNote]);

  const handleDeleteNote = async () => {
    const deleted = await onDeleteNote();
    if (deleted) {
      setIsConfirmingDelete(false);
      setIsMenuOpen(false);
    }
  };

  if (!hasNote) {
    return (
      <div className="rd-note-empty">
        <p className="rd-note-empty-title">No note for this document yet</p>
        <p className="rd-note-empty-sub">Write your synthesis beside the source; excerpts you add link back to their page.</p>
        <button type="button" className="rd-text-btn is-primary" onClick={onStartNote}>
          <PenLine size={13} strokeWidth={1.8} aria-hidden="true" />
          Start note
        </button>
      </div>
    );
  }

  return (
    <div className="rd-note">
      <div className="rd-note-tools">
        <span className="rd-spacer" />

        <button
          type="button"
          className={`rd-save status-${noteSaveStatus}`}
          onClick={onSaveNote}
          title={noteSaveStatus === "error" ? noteError || "Retry save" : "Save now (Ctrl+S)"}
          aria-live="polite"
        >
          <span className="rd-save-dot" />
          {saveStatusLabel(noteSaveStatus, noteSaveStatus === "error" ? "Save failed" : null)}
        </button>

        <div className="rd-menu-anchor" ref={menuRef}>
          <button
            ref={menuTriggerRef}
            type="button"
            className="rd-icon rd-icon-sm"
            onClick={() => setIsMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            title="More note actions"
            aria-label="More note actions"
            data-dismiss-ignore
          >
            <MoreHorizontal size={14} strokeWidth={1.7} aria-hidden="true" />
          </button>
          {isMenuOpen && (
            <div className="reader-popover rd-menu" role="menu">
              {isConfirmingDelete ? (
                <>
                  <p className="rd-menu-note">Delete this note permanently?</p>
                  <button type="button" role="menuitem" className="reader-popover-action destructive" onClick={() => void handleDeleteNote()}>
                    Delete note
                  </button>
                  <button type="button" role="menuitem" className="reader-popover-action" onClick={() => setIsConfirmingDelete(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="reader-popover-action"
                    onClick={() => {
                      onSaveNote();
                      setIsMenuOpen(false);
                    }}
                  >
                    <Check size={13} aria-hidden="true" /> Save now
                  </button>
                  <div className="reader-popover-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    className="reader-popover-action destructive"
                    onClick={() => setIsConfirmingDelete(true)}
                  >
                    <Trash2 size={13} aria-hidden="true" /> Delete note…
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="rd-note-page">
        <textarea
          ref={titleRef}
          className="rd-note-title"
          rows={1}
          value={noteTitle}
          onChange={(event) => onNoteTitleChange(event.target.value.replace(/[\r\n]+/g, " "))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              bodyRef.current?.focus();
            }
          }}
          placeholder="Untitled note"
          aria-label="Note title"
        />
        <label className="rd-note-tags">
          <Hash size={11} strokeWidth={1.8} aria-hidden="true" />
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
            placeholder="Add tags"
            aria-label="Note tags"
          />
        </label>

        {noteExcerpts.length > 0 && (
          <div className="rd-source-chips" aria-label="Source passages">
            {noteExcerpts.map((excerpt) => (
              <button
                key={excerpt.id}
                type="button"
                className="rd-source-chip"
                onClick={() => onJumpToPage(excerpt.page, excerpt.attachmentId)}
                title={excerpt.text}
              >
                <span className="rd-source-page">p. {excerpt.page}</span>
                <span className="rd-source-text">{excerpt.text}</span>
              </button>
            ))}
          </div>
        )}

        <div className="rd-note-body">
          <RichTextEditor
            ref={bodyRef}
            value={noteContent}
            onChange={onNoteContentChange}
            placeholder="Write your research notes… Select text to format it."
            ariaLabel="Note content"
          />
        </div>
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
    <section className="rd-passages" aria-label="Passages and annotations">
      <div className="rd-filter" role="group" aria-label="Filter passages">
        {["all", "important", "question", "insight", "definition"].map((type) => {
          const count =
            type === "all" ? highlights.length : highlights.filter((item) => item.highlight_type === type).length;
          return (
            <button
              key={type}
              type="button"
              className={filterType === type ? "is-active" : ""}
              onClick={() => setFilterType(type)}
            >
              {type !== "all" && <span className={`hl-dot ${type}`} aria-hidden="true" />}
              {type.charAt(0).toUpperCase() + type.slice(1)}
              {count > 0 && <span className="rd-filter-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {filteredHighlights.length === 0 ? (
        <p className="rd-empty">
          {highlights.length === 0
            ? "Select text in the document to highlight a passage."
            : `No ${filterType} passages yet.`}
        </p>
      ) : (
        filteredHighlights.map((highlight) => (
          <article
            key={highlight.id}
            className={`rd-passage ${selectedHighlightId === highlight.id ? "is-selected" : ""}`}
            onClick={() => onSelectHighlight(highlight.id)}
          >
            <div className="rd-passage-head">
              <span className={`hl-dot ${highlight.highlight_type}`} aria-hidden="true" />
              <span className="rd-passage-type">{highlight.highlight_type}</span>
              <button
                type="button"
                className="rd-passage-page"
                onClick={(event) => {
                  event.stopPropagation();
                  onJumpToPage(highlight.page_number);
                }}
                title={`Jump to page ${highlight.page_number}`}
              >
                p. {highlight.page_number}
              </button>
              <span className="rd-spacer" />
              <div className="rd-passage-actions" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="rd-icon rd-icon-sm"
                  onClick={() => handleStartEditNote(highlight)}
                  title={highlight.annotation ? "Edit annotation" : "Add annotation"}
                  aria-label={highlight.annotation ? "Edit annotation" : "Add annotation"}
                >
                  <MessageSquarePlus size={13} strokeWidth={1.7} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="rd-icon rd-icon-sm"
                  onClick={() => onOpenConnectModal(highlight)}
                  title="Connect to a knowledge record"
                  aria-label="Connect to a knowledge record"
                >
                  <Link2 size={13} strokeWidth={1.7} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="rd-icon rd-icon-sm is-danger"
                  onClick={() => setDeleteRequest({ id: highlight.id, kind: "highlight" })}
                  title="Delete highlight"
                  aria-label="Delete highlight"
                >
                  <Trash2 size={13} strokeWidth={1.7} aria-hidden="true" />
                </button>
              </div>
            </div>

            {highlight.is_stale && (
              <p className="rd-stale">Anchored to an earlier version of this document.</p>
            )}

            <blockquote className="rd-passage-quote">{highlight.selected_text}</blockquote>

            {editingHighlightId === highlight.id ? (
              <div className="rd-annotation-edit" onClick={(event) => event.stopPropagation()}>
                <textarea
                  className="rd-annotation-input"
                  value={editNoteContent}
                  onChange={(event) => setEditNoteContent(event.target.value)}
                  placeholder="Your reflection, question, or note…"
                  autoFocus
                />
                <div className="rd-inline-actions">
                  {highlight.annotation && (
                    <button
                      type="button"
                      className="rd-link is-danger"
                      onClick={() => setDeleteRequest({ id: highlight.id, kind: "annotation" })}
                    >
                      Remove
                    </button>
                  )}
                  <span className="rd-spacer" />
                  <button type="button" className="rd-link" onClick={() => setEditingHighlightId(null)}>
                    Cancel
                  </button>
                  <button type="button" className="rd-text-btn is-primary is-small" onClick={() => handleSaveAnnotation(highlight)}>
                    Save
                  </button>
                </div>
              </div>
            ) : (
              highlight.annotation && <p className="rd-annotation">{highlight.annotation.content}</p>
            )}

            {deleteRequest?.id === highlight.id && (
              <div className="rd-inline-actions rd-confirm" onClick={(event) => event.stopPropagation()}>
                <span>Delete {deleteRequest.kind}?</span>
                <span className="rd-spacer" />
                <button type="button" className="rd-link" onClick={() => setDeleteRequest(null)}>
                  Cancel
                </button>
                <button type="button" className="rd-link is-danger" onClick={() => void handleConfirmDelete(highlight)}>
                  Delete
                </button>
              </div>
            )}
          </article>
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

  const activeView = DRAWER_VIEWS.find((view) => view.id === activeTab) ?? DRAWER_VIEWS[0];

  return (
    <aside className="reader-drawer rd-drawer" aria-label="Research writing workspace">
      <div className="rd-head">
        <span className="rd-head-title">{activeView.label}</span>
        <div className="rd-head-tools" role="tablist" aria-label="Writing tools">
          {DRAWER_VIEWS.map(({ id, label, icon: Icon }) => {
            const count = id === "passages" ? highlights.length : 0;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                className={`rd-icon ${activeTab === id ? "is-active" : ""}`}
                onClick={() => onTabChange(id)}
                aria-selected={activeTab === id}
                data-reader-tab={id}
                title={count > 0 ? `${label} (${count})` : label}
                aria-label={label}
              >
                <Icon size={15} strokeWidth={1.6} aria-hidden="true" />
                {count > 0 && <span className="rd-badge" aria-hidden="true" />}
              </button>
            );
          })}
          <span className="rd-rule" aria-hidden="true" />
          <button
            type="button"
            className="rd-icon"
            onClick={onClose}
            aria-label="Return to reading mode"
            title="Close (return to reading)"
          >
            <X size={15} strokeWidth={1.6} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className={`reader-drawer-content rd-body view-${activeTab}`} ref={contentScrollRef}>
        {activeTab === "highlights" && (
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
        )}

        {activeTab === "passages" && (
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
        )}

        {activeTab === "outline" && (
          <nav className="rd-outline" aria-label="Document outline">
            {outline.length === 0 ? (
              <p className="rd-empty">No bookmarks or headings found in this document.</p>
            ) : (
              <ol>
                {outline.map((item, index) => (
                  <li key={`${item.title}-${index}`}>
                    <button type="button" onClick={() => item.pageNumber && onJumpToPage(item.pageNumber)} title={item.title}>
                      <span className="rd-outline-text">{item.title}</span>
                      {item.pageNumber && <span className="rd-outline-page">{item.pageNumber}</span>}
                    </button>
                    {item.items && item.items.length > 0 && (
                      <ol>
                        {item.items.map((sub, subIndex) => (
                          <li key={`${sub.title}-${subIndex}`}>
                            <button type="button" onClick={() => sub.pageNumber && onJumpToPage(sub.pageNumber)} title={sub.title}>
                              <span className="rd-outline-text">{sub.title}</span>
                              {sub.pageNumber && <span className="rd-outline-page">{sub.pageNumber}</span>}
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </nav>
        )}

        {activeTab === "knowledge" && (
          <div className="rd-links">
            {attachment.record_count === 0 ? (
              <p className="rd-empty">
                No knowledge records currently reference this document.
                <br />
                Use <strong>Connect</strong> on a passage to link it to a record.
              </p>
            ) : isLoadingLinkedRecords ? (
              <p className="rd-empty">Loading linked records…</p>
            ) : linkedRecords.length === 0 ? (
              <p className="rd-empty">No linked knowledge records could be resolved for this document.</p>
            ) : (
              <>
                <ul className="rd-link-list">
                  {linkedRecords.map((record) => (
                    <li key={record.id}>
                      <button
                        type="button"
                        disabled={!onNavigateToRecord}
                        onClick={() => {
                          if (onNavigateToRecord && record.id.trim()) {
                            onNavigateToRecord(record.id);
                          }
                        }}
                        title={record.title}
                      >
                        <span>{record.title}</span>
                        <ChevronRight size={13} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="reader-embedded-graph rd-graph">
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
          <div className="rd-info">
            <dl>
              <dt>File</dt>
              <dd>{attachment.file_name}</dd>
              <dt>Format</dt>
              <dd>{attachment.mime_type}</dd>
              <dt>Size</dt>
              <dd>{formatBytes(attachment.file_size)}</dd>
              <dt>Added</dt>
              <dd>{new Date(attachment.created_at).toLocaleString()}</dd>
              <dt>Passages</dt>
              <dd>{highlights.length}</dd>
              <dt>SHA-256</dt>
              <dd><code>{attachment.sha256_hash}</code></dd>
            </dl>
            <div className="rd-inline-actions rd-danger-zone">
              {isConfirmingDocumentDelete ? (
                <>
                  <span>Delete from vault with all its highlights and annotations?</span>
                  <span className="rd-spacer" />
                  <button type="button" className="rd-link" onClick={() => setIsConfirmingDocumentDelete(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rd-link is-danger"
                    onClick={async () => {
                      const deleted = await onDeleteDocument(attachment.id);
                      if (deleted) setIsConfirmingDocumentDelete(false);
                    }}
                  >
                    Delete file
                  </button>
                </>
              ) : (
                <button type="button" className="rd-link is-danger" onClick={() => setIsConfirmingDocumentDelete(true)}>
                  Delete file from vault…
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
