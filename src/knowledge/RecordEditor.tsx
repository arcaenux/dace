import {
  useState,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
  KeyboardEvent,
} from "react";
import { KnowledgeRecord, SaveStatus } from "./types";
import { RecordRelationshipsPanel } from "./RecordRelationshipsPanel";
import { RecordAttachmentsPanel } from "../attachments/RecordAttachmentsPanel";
import { RecordExcerptsSection } from "../reader/RecordExcerptsSection";

export interface RecordEditorHandle {
  flushSave: () => Promise<boolean>;
  isDirty: () => boolean;
  isSaving: () => boolean;
  getRecordId: () => string;
}

export interface RecordEditorProps {
  record: KnowledgeRecord;
  onSaveRecord: (id: string, title: string, content: string, tags: string[]) => Promise<KnowledgeRecord>;
  onDeleteRecord: (id: string) => void;
  isFocusSpace: boolean;
  onToggleRecordList: () => void;
  isListOpen: boolean;
  onNavigateToRecord: (targetId: string) => void;
  onShowNotice: (msg: string) => void;
  canNavigateBack?: boolean;
  onNavigateBack?: () => void;
  previousRecordTitle?: string | null;
  onOpenExcerptInReader?: (attachmentId: string, pageNumber: number) => void;
}

export const RecordEditor = forwardRef<RecordEditorHandle, RecordEditorProps>(function RecordEditor(
  {
    record,
    onSaveRecord,
    onDeleteRecord,
    isFocusSpace,
    onToggleRecordList,
    isListOpen,
    onNavigateToRecord,
    onShowNotice,
    canNavigateBack,
    onNavigateBack,
    previousRecordTitle,
    onOpenExcerptInReader,
  },
  ref
) {
  const [title, setTitle] = useState(record.title);
  const [content, setContent] = useState(record.content);
  const [tags, setTags] = useState<string[]>(record.tags);
  const [tagInput, setTagInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const debounceTimerRef = useRef<number | null>(null);
  const inFlightPromiseRef = useRef<Promise<boolean> | null>(null);
  const isDirtyRef = useRef<boolean>(false);
  const currentRecordIdRef = useRef<string>(record.id);

  // Monotonically increasing sequence counters for strictly ordered concurrency
  const mutationSeqRef = useRef<number>(0);
  const lastSavedSeqRef = useRef<number>(0);

  // Synchronized refs to guarantee zero data loss during unmounts, closes or record switches
  const titleRef = useRef<string>(record.title);
  const contentRef = useRef<string>(record.content);
  const tagsRef = useRef<string[]>(record.tags);

  // Core persistence function ensuring at most one active save per record,
  // queuing changes made during an active save, and never overwriting newer edits.
  const performSave = useCallback(async (): Promise<boolean> => {
    // 1. If an active save is already in progress, await its completion first
    if (inFlightPromiseRef.current) {
      try {
        await inFlightPromiseRef.current;
      } catch {
        // Handled in that save's catch block
      }
      // If no new mutations were made while waiting for the in-flight save to finish:
      if (mutationSeqRef.current <= lastSavedSeqRef.current) {
        return !isDirtyRef.current;
      }
    }

    // 2. Clear any pending debounce timer
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // 3. Check if there are unsaved mutations
    if (mutationSeqRef.current <= lastSavedSeqRef.current) {
      return true;
    }

    // 4. Capture snapshot of state to be saved
    const targetId = currentRecordIdRef.current;
    const targetSeq = mutationSeqRef.current;
    const saveTitle = titleRef.current;
    const saveContent = contentRef.current;
    const saveTags = [...tagsRef.current];

    setSaveStatus("saving");
    setErrorMessage(null);

    const execPromise = (async (): Promise<boolean> => {
      try {
        await onSaveRecord(targetId, saveTitle, saveContent, saveTags);

        // Ensure active editor still corresponds to this record
        if (currentRecordIdRef.current === targetId) {
          if (targetSeq > lastSavedSeqRef.current) {
            lastSavedSeqRef.current = targetSeq;
          }

          // Did user make additional edits while the save was in flight?
          if (mutationSeqRef.current > targetSeq) {
            isDirtyRef.current = true;
            setSaveStatus("unsaved");
            // Schedule immediate follow-up autosave
            if (debounceTimerRef.current !== null) {
              window.clearTimeout(debounceTimerRef.current);
            }
            debounceTimerRef.current = window.setTimeout(() => {
              performSave();
            }, 1000);
          } else {
            isDirtyRef.current = false;
            setSaveStatus("saved");
          }
        }
        return true;
      } catch (err) {
        if (currentRecordIdRef.current === targetId) {
          isDirtyRef.current = true;
          setSaveStatus("error");
          setErrorMessage(err instanceof Error ? err.message : "Failed to persist record to SQLite");
        }
        return false;
      } finally {
        inFlightPromiseRef.current = null;
      }
    })();

    inFlightPromiseRef.current = execPromise;
    return await execPromise;
  }, [onSaveRecord]);

  // Trigger debounced autosave when user edits
  const triggerAutosave = useCallback(() => {
    isDirtyRef.current = true;
    setSaveStatus("unsaved");

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      performSave();
    }, 1000);
  }, [performSave]);

  // Flush save immediately (clears debounce timer and awaits save)
  const flushSave = useCallback(async (): Promise<boolean> => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    return await performSave();
  }, [performSave]);

  // Expose imperatively to parent coordinator (KnowledgeDesk)
  useImperativeHandle(
    ref,
    () => ({
      flushSave,
      isDirty: () => isDirtyRef.current || mutationSeqRef.current > lastSavedSeqRef.current,
      isSaving: () => inFlightPromiseRef.current !== null,
      getRecordId: () => currentRecordIdRef.current,
    }),
    [flushSave]
  );

  // Sync internal state when active record changes (controlled by KnowledgeDesk)
  useEffect(() => {
    if (currentRecordIdRef.current !== record.id) {
      currentRecordIdRef.current = record.id;
      titleRef.current = record.title;
      contentRef.current = record.content;
      tagsRef.current = record.tags;
      mutationSeqRef.current = 0;
      lastSavedSeqRef.current = 0;
      isDirtyRef.current = false;
      inFlightPromiseRef.current = null;

      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      setTitle(record.title);
      setContent(record.content);
      setTags(record.tags);
      setTagInput("");
      setSaveStatus("saved");
      setErrorMessage(null);
    }
  }, [record.id, record.title, record.content, record.tags]);

  // Global save event listener (Ctrl+S or command palette)
  useEffect(() => {
    const handleGlobalSaveRequest = (e: CustomEvent) => {
      if (e.detail?.recordId === record.id || !e.detail?.recordId) {
        flushSave();
      }
    };
    window.addEventListener("novadome:save-record" as any, handleGlobalSaveRequest);
    return () => {
      window.removeEventListener("novadome:save-record" as any, handleGlobalSaveRequest);
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [flushSave, record.id]);

  const handleTitleChange = (val: string) => {
    titleRef.current = val;
    setTitle(val);
    mutationSeqRef.current += 1;
    triggerAutosave();
  };

  const handleContentChange = (val: string) => {
    contentRef.current = val;
    setContent(val);
    mutationSeqRef.current += 1;
    triggerAutosave();
  };

  const handleAddTag = () => {
    const clean = tagInput.trim().toLowerCase();
    if (clean && !tags.includes(clean)) {
      const updated = [...tags, clean];
      tagsRef.current = updated;
      setTags(updated);
      setTagInput("");
      mutationSeqRef.current += 1;
      triggerAutosave();
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const updated = tags.filter((t) => t !== tagToRemove);
    tagsRef.current = updated;
    setTags(updated);
    mutationSeqRef.current += 1;
    triggerAutosave();
  };

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTag();
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      handleRemoveTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className={`editor-container ${isFocusSpace ? "in-focus" : ""}`}>
      {/* Editor Meta & Control Bar */}
      <div className="editor-meta-bar">
        <div className="editor-meta-left">
          {canNavigateBack && onNavigateBack && (
            <button
              type="button"
              className="desk-btn"
              onClick={onNavigateBack}
              title={`Return to '${previousRecordTitle || "previous concept"}'`}
            >
              <span className="btn-icon">←</span>
              <span>Back</span>
            </button>
          )}

          <button
            type="button"
            className="desk-btn"
            onClick={onToggleRecordList}
            title={isListOpen ? "Hide record list (Ctrl+B)" : "Show record list (Ctrl+B)"}
          >
            <span className="btn-icon">{isListOpen ? "◀" : "▶"}</span>
            <span>{isListOpen ? "Hide List" : "Records"}</span>
          </button>

          {/* Real-time Save Status Indicator */}
          <div className="save-status-indicator" aria-live="polite">
            {saveStatus === "saving" && (
              <span className="status-saving">
                <span className="status-dot pulsing"></span> Saving…
              </span>
            )}
            {saveStatus === "unsaved" && (
              <span className="status-unsaved">
                <span className="status-dot yellow"></span> Unsaved
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="status-saved">
                <span className="status-dot green"></span> Saved
              </span>
            )}
            {saveStatus === "error" && (
              <span
                className="status-error"
                title={errorMessage || "Database write error. Click to retry."}
                onClick={flushSave}
                style={{ cursor: "pointer" }}
              >
                <span className="status-dot red"></span> Error saving (click to retry)
              </span>
            )}
          </div>
        </div>

        <div className="editor-meta-right">
          <button
            type="button"
            className="desk-btn"
            onClick={flushSave}
            title="Save immediately (Ctrl+S)"
          >
            Save
          </button>
          <button
            type="button"
            className="desk-btn danger"
            onClick={() => onDeleteRecord(record.id)}
            title="Delete this record"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="editor-body">
        {/* Title Input */}
        <input
          type="text"
          className="editor-title-input"
          placeholder="Untitled Record"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          aria-label="Record title"
        />

        {/* Tags Row */}
        <div className="editor-tags-container">
          <div className="tags-list">
            {tags.map((t) => (
              <span key={t} className="tag-chip">
                #{t}
                <button
                  type="button"
                  className="tag-remove-btn"
                  onClick={() => handleRemoveTag(t)}
                  aria-label={`Remove tag ${t}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              type="text"
              className="tag-input"
              placeholder="+ add tag (Enter)"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
            />
          </div>
        </div>

        {/* Content Textarea */}
        <textarea
          className="editor-textarea"
          placeholder="Write knowledge here... (Markdown supported)"
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          aria-label="Record content"
        />

        {/* Connected Concepts Section */}
        <RecordRelationshipsPanel
          recordId={record.id}
          recordTitle={title}
          onNavigateToRecord={onNavigateToRecord}
          onShowNotice={onShowNotice}
        />

        {/* Managed Research Documents & Ingestion Section */}
        <RecordAttachmentsPanel
          recordId={record.id}
          onShowNotice={onShowNotice}
          onOpenInReader={onOpenExcerptInReader}
        />

        {/* Connected Research Excerpts & Quotations */}
        <RecordExcerptsSection
          recordId={record.id}
          onOpenExcerptInReader={onOpenExcerptInReader}
          onShowNotice={onShowNotice}
        />
      </div>
    </div>
  );
});