import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
  KeyboardEvent,
} from "react";
import { ArrowLeft, MoreHorizontal, PanelLeft, PanelRight, Save } from "lucide-react";
import { KnowledgeRecord, SaveStatus } from "./types";
import { useDismissable } from "../core/useDismissable";
import { useSettings } from "../settings/SettingsContext";

export interface RecordEditorHandle {
  flushSave: () => Promise<boolean>;
  isDirty: () => boolean;
  isSaving: () => boolean;
  getRecordId: () => string;
  jumpToLine: (line: number) => void;
}

export interface RecordEditorProps {
  record: KnowledgeRecord;
  onSaveRecord: (id: string, title: string, content: string, tags: string[]) => Promise<KnowledgeRecord>;
  onDeleteRecord: (id: string) => void;
  isFocusSpace: boolean;
  onToggleRecordList: () => void;
  isListOpen: boolean;
  onContentChange: (content: string) => void;
  canNavigateBack?: boolean;
  onNavigateBack?: () => void;
  previousRecordTitle?: string | null;
  isContextOpen?: boolean;
  onToggleContext?: () => void;
}

const statusLabels: Record<SaveStatus, string> = {
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Unsaved",
  error: "Save error",
};

export const RecordEditor = forwardRef<RecordEditorHandle, RecordEditorProps>(function RecordEditor(
  {
    record,
    onSaveRecord,
    onDeleteRecord,
    isFocusSpace,
    onToggleRecordList,
    isListOpen,
    onContentChange,
    canNavigateBack,
    onNavigateBack,
    previousRecordTitle,
    isContextOpen = false,
    onToggleContext,
  },
  ref
) {
  const [title, setTitle] = useState(record.title);
  const [content, setContent] = useState(record.content);
  const [tags, setTags] = useState<string[]>(record.tags);
  const [tagInput, setTagInput] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const { settings } = useSettings();
  const autosaveDelayMs = settings.editor.autosaveDelayMs;

  const titleTextareaRef = useRef<HTMLTextAreaElement>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);

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

  useDismissable(isMoreMenuOpen, () => setIsMoreMenuOpen(false), moreMenuRef, {
    triggerRef: moreTriggerRef,
    group: "workspace-overlay",
    restoreFocus: true,
  });

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
            }, autosaveDelayMs);
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
  }, [autosaveDelayMs, onSaveRecord]);

  // Trigger debounced autosave when user edits
  const triggerAutosave = useCallback(() => {
    isDirtyRef.current = true;
    setSaveStatus("unsaved");

    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      performSave();
    }, autosaveDelayMs);
  }, [autosaveDelayMs, performSave]);

  // Flush save immediately. Drain every queued mutation so a delete cannot
  // race a follow-up autosave scheduled while the previous save was in flight.
  const flushSave = useCallback(async (): Promise<boolean> => {
    let ok = true;
    for (let round = 0; round < 8; round += 1) {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (!inFlightPromiseRef.current && mutationSeqRef.current <= lastSavedSeqRef.current) break;
      const saved = await performSave();
      ok = saved && ok;
      if (!saved) return false;
    }
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    return ok && mutationSeqRef.current <= lastSavedSeqRef.current;
  }, [performSave]);

  // Move the caret to a real line in the body canvas (used by the Outline view).
  const jumpToLine = useCallback((line: number) => {
    const textarea = bodyTextareaRef.current;
    if (!textarea) return;
    const lines = textarea.value.split(/\r?\n/);
    const target = Math.max(1, Math.min(line, lines.length));
    let offset = 0;
    for (let index = 0; index < target - 1; index += 1) {
      offset += lines[index].length + 1;
    }
    textarea.focus();
    textarea.setSelectionRange(offset, offset + (lines[target - 1]?.length || 0));
    const lineHeight = parseFloat(window.getComputedStyle(textarea).lineHeight) || 26;
    textarea.scrollTop = Math.max(0, (target - 1) * lineHeight - textarea.clientHeight / 3);
  }, []);

  // Expose imperatively to parent coordinator (KnowledgeDesk)
  useImperativeHandle(
    ref,
    () => ({
      flushSave,
      isDirty: () => isDirtyRef.current || mutationSeqRef.current > lastSavedSeqRef.current,
      isSaving: () => inFlightPromiseRef.current !== null,
      getRecordId: () => currentRecordIdRef.current,
      jumpToLine,
    }),
    [flushSave, jumpToLine]
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
      setIsAddingTag(false);
      setSaveStatus("saved");
      setErrorMessage(null);
      onContentChange(record.content);
    }
  }, [record.id, record.title, record.content, record.tags, onContentChange]);

  // Global save event listener (Ctrl+S or command palette)
  useEffect(() => {
    const handleGlobalSaveRequest = (e: CustomEvent) => {
      if (e.detail?.recordId === record.id || !e.detail?.recordId) {
        flushSave();
      }
    };
    window.addEventListener("dace:save-record" as any, handleGlobalSaveRequest);
    window.addEventListener("novadome:save-record" as any, handleGlobalSaveRequest);
    return () => {
      window.removeEventListener("dace:save-record" as any, handleGlobalSaveRequest);
      window.removeEventListener("novadome:save-record" as any, handleGlobalSaveRequest);
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [flushSave, record.id]);

  // Long titles wrap naturally instead of being clipped by a single-line input.
  useLayoutEffect(() => {
    const textarea = titleTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [title]);

  const wordCount = useMemo(() => {
    const trimmed = content.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [content]);

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
    onContentChange(val);
    triggerAutosave();
  };

  const handleAddTag = () => {
    const clean = tagInput.trim().toLowerCase();
    if (clean && !tags.includes(clean)) {
      const updated = [...tags, clean];
      tagsRef.current = updated;
      setTags(updated);
      mutationSeqRef.current += 1;
      triggerAutosave();
    }
    setTagInput("");
    setIsAddingTag(false);
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
    } else if (e.key === "Escape") {
      e.preventDefault();
      setTagInput("");
      setIsAddingTag(false);
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      handleRemoveTag(tags[tags.length - 1]);
    }
  };

  const handleStartAddingTag = () => {
    setIsAddingTag(true);
    requestAnimationFrame(() => tagInputRef.current?.focus());
  };

  const runDelete = () => {
    setIsMoreMenuOpen(false);
    onDeleteRecord(record.id);
  };

  return (
    <div className={`editor-container ${isFocusSpace ? "in-focus" : ""}`}>
      <div className="desk-toolbar">
        <div className="desk-toolbar-left">
          {canNavigateBack && onNavigateBack && (
            <button
              type="button"
              className="desk-toolbar-icon"
              onClick={onNavigateBack}
              title={`Return to '${previousRecordTitle || "previous concept"}'`}
              aria-label="Back to previous record"
            >
              <ArrowLeft size={15} strokeWidth={1.6} aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            className="desk-toolbar-icon"
            data-dismiss-ignore
            data-tauri-drag-region="false"
            onClick={onToggleRecordList}
            aria-expanded={isListOpen}
            title={isListOpen ? "Hide records" : "Browse records"}
            aria-label={isListOpen ? "Hide records" : "Browse records"}
          >
            <PanelLeft size={15} strokeWidth={1.6} aria-hidden="true" />
          </button>

          <span className="desk-toolbar-rule" aria-hidden="true" />

          <div className={`desk-save-status ${saveStatus}`} aria-live="polite">
            {saveStatus === "error" ? (
              <button type="button" onClick={flushSave} title={errorMessage || "Click to retry save"}>
                <span className="status-dot" />
                {statusLabels[saveStatus]} · Retry
              </button>
            ) : (
              <>
                <span className="status-dot" />
                {statusLabels[saveStatus]}
              </>
            )}
          </div>
        </div>

        <div className="desk-toolbar-right">
          {settings.editor.showWordCount && (
            <span className="desk-word-count" aria-label="Word count">
              {wordCount} {wordCount === 1 ? "word" : "words"}
            </span>
          )}

          {(saveStatus === "unsaved" || saveStatus === "error") && (
            <button
              type="button"
              className={`desk-save-button ${saveStatus === "error" ? "is-error" : ""}`}
              onClick={flushSave}
              title="Save now (Ctrl+S)"
            >
              <Save size={13} strokeWidth={1.6} aria-hidden="true" />
              {saveStatus === "error" ? "Retry" : "Save"}
            </button>
          )}

          <button
            ref={moreTriggerRef}
            type="button"
            className="desk-toolbar-icon"
            data-dismiss-ignore
            aria-haspopup="menu"
            aria-expanded={isMoreMenuOpen}
            onClick={() => setIsMoreMenuOpen((current) => !current)}
            title="More actions"
            aria-label="More actions"
          >
            <MoreHorizontal size={16} strokeWidth={1.6} aria-hidden="true" />
          </button>

          {isMoreMenuOpen && (
            <div ref={moreMenuRef} className="desk-actions-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsMoreMenuOpen(false);
                  void flushSave();
                }}
              >
                Save now
                <kbd>Ctrl S</kbd>
              </button>
              <span className="desk-actions-divider" aria-hidden="true" />
              <button type="button" role="menuitem" className="destructive" onClick={runDelete}>
                Delete record
              </button>
            </div>
          )}

          {onToggleContext && !isFocusSpace && (
            <button
              type="button"
              className={`desk-toolbar-icon ${isContextOpen ? "active" : ""}`}
              onClick={onToggleContext}
              title={isContextOpen ? "Hide context panel" : "Context (Connections, Documents, Outline)"}
              aria-label="Toggle context panel"
              aria-pressed={isContextOpen}
            >
              <PanelRight size={15} strokeWidth={1.6} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="editor-scroll-area">
        <div className="editor-document">
          <textarea
            ref={titleTextareaRef}
            className="editor-title-input"
            rows={1}
            placeholder="Untitled Record"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            aria-label="Record title"
          />

          <div className={`editor-tags-container ${tags.length === 0 && !isAddingTag ? "is-empty" : ""}`}>
            <div className="tags-list">
              {tags.map((t) => (
                <span key={t} className="tag-chip">
                  {t}
                  <button
                    type="button"
                    className="tag-remove-btn"
                    onClick={() => handleRemoveTag(t)}
                    aria-label={`Remove tag ${t}`}
                    title={`Remove ${t}`}
                  >
                    ×
                  </button>
                </span>
              ))}

              {isAddingTag ? (
                <input
                  ref={tagInputRef}
                  type="text"
                  className="tag-input"
                  placeholder="tag name"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={handleAddTag}
                  aria-label="Tag name"
                />
              ) : (
                <button type="button" className="add-tag-button" onClick={handleStartAddingTag}>
                  + Add tag
                </button>
              )}
            </div>
          </div>

          <textarea
            ref={bodyTextareaRef}
            className="editor-textarea"
            placeholder={
              settings.editor.defaultFormat === "markdown"
                ? "Write knowledge here… (Markdown supported)"
                : "Write knowledge here…"
            }
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            spellCheck={settings.editor.spellcheck}
            aria-label="Record content"
          />
        </div>
      </div>
    </div>
  );
});
