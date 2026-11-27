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
  ReactNode,
} from "react";
import {
  ArrowLeft,
  Hash,
  MoreHorizontal,
  PanelLeft,
  X,
} from "lucide-react";
import { RichTextEditor, type RichTextEditorHandle } from "../editor/RichTextEditor.tsx";
import { extractDeskOutline } from "./KnowledgeContextPanel.tsx";
import { visibleNoteTags } from "../reader/noteSaveState.ts";
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
  /** Small panel toggles rendered at the end of the editor bar. */
  trailingControls?: ReactNode;
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
    trailingControls,
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
  const bodyEditorRef = useRef<RichTextEditorHandle>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
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

  // The Outline lists Markdown headings by line; the editor finds the same
  // heading by its position among all headings.
  const jumpToLine = useCallback((line: number) => {
    const index = extractDeskOutline(contentRef.current).findIndex((item) => item.line === line);
    if (index >= 0) bodyEditorRef.current?.jumpToHeading(index);
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
    return () => {
      window.removeEventListener("dace:save-record" as any, handleGlobalSaveRequest);
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

  // Internal link tags (reader-note:<id>) stay saved but are never shown.
  const shownTags = useMemo(() => visibleNoteTags(tags), [tags]);

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
    } else if (e.key === "Backspace" && !tagInput && shownTags.length > 0) {
      handleRemoveTag(shownTags[shownTags.length - 1]);
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

  const saveLabel = saveStatus === "saved" ? "Saved" : statusLabels[saveStatus];

  return (
    <div className={`kd-editor ${isFocusSpace ? "in-focus" : ""}`}>
      <header className="kd-bar">
        <div className="kd-bar-start">
          {!isFocusSpace && (
            <button
              type="button"
              className={`kd-icon ${isListOpen ? "is-active" : ""}`}
              data-dismiss-ignore
              data-tauri-drag-region="false"
              onClick={onToggleRecordList}
              aria-expanded={isListOpen}
              title={isListOpen ? "Hide library" : "Show library"}
              aria-label={isListOpen ? "Hide library" : "Show library"}
            >
              <PanelLeft size={15} strokeWidth={1.6} aria-hidden="true" />
            </button>
          )}
          {canNavigateBack && onNavigateBack && (
            <button
              type="button"
              className="kd-icon"
              onClick={onNavigateBack}
              title={`Back to '${previousRecordTitle || "previous record"}'`}
              aria-label="Back to previous record"
            >
              <ArrowLeft size={15} strokeWidth={1.6} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Formatting lives in the toolbar that appears over selected text. */}
        <div className="kd-bar-spacer" aria-hidden="true" />

        <div className="kd-bar-end">
          {saveStatus === "error" ? (
            <button
              type="button"
              className="kd-save is-error"
              onClick={flushSave}
              title={errorMessage || "Click to retry save"}
              aria-live="polite"
            >
              <span className="kd-save-dot" />
              Save failed · Retry
            </button>
          ) : (
            <button
              type="button"
              className={`kd-save is-${saveStatus}`}
              onClick={flushSave}
              title="Save now (Ctrl+S)"
              aria-live="polite"
            >
              <span className="kd-save-dot" />
              {saveLabel}
            </button>
          )}

          {settings.editor.showWordCount && (
            <span className="kd-meta-text desk-word-count" aria-label="Word count">
              {wordCount} {wordCount === 1 ? "word" : "words"}
            </span>
          )}

          <div className="kd-menu-anchor">
            <button
              ref={moreTriggerRef}
              type="button"
              className="kd-icon"
              data-dismiss-ignore
              aria-haspopup="menu"
              aria-expanded={isMoreMenuOpen}
              onClick={() => setIsMoreMenuOpen((current) => !current)}
              title="More actions"
              aria-label="More actions"
            >
              <MoreHorizontal size={15} strokeWidth={1.6} aria-hidden="true" />
            </button>

            {isMoreMenuOpen && (
              <div ref={moreMenuRef} className="kd-menu" role="menu">
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
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    handleStartAddingTag();
                  }}
                >
                  Add tag
                </button>
                <span className="kd-menu-divider" aria-hidden="true" />
                <button type="button" role="menuitem" className="destructive" onClick={runDelete}>
                  Delete record
                </button>
              </div>
            )}
          </div>

          {trailingControls && !isFocusSpace && (
            <>
              <span className="kd-bar-rule" aria-hidden="true" />
              {trailingControls}
            </>
          )}
        </div>
      </header>

      <div className="kd-scroll" ref={scrollAreaRef}>
        <article className="kd-page">
          <textarea
            ref={titleTextareaRef}
            className="kd-title"
            rows={1}
            placeholder="Untitled"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                bodyEditorRef.current?.focus();
              }
            }}
            aria-label="Record title"
          />

          <div className={`kd-tags ${shownTags.length === 0 && !isAddingTag ? "is-empty" : ""}`}>
            {shownTags.map((t) => (
              <span key={t} className="kd-tag">
                <span className="kd-tag-hash" aria-hidden="true">#</span>
                {t}
                <button
                  type="button"
                  className="kd-tag-remove"
                  onClick={() => handleRemoveTag(t)}
                  aria-label={`Remove tag ${t}`}
                  title={`Remove ${t}`}
                >
                  <X size={10} strokeWidth={2} aria-hidden="true" />
                </button>
              </span>
            ))}

            {isAddingTag ? (
              <input
                ref={tagInputRef}
                type="text"
                className="kd-tag-input"
                placeholder="tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={handleAddTag}
                aria-label="Tag name"
              />
            ) : (
              <button type="button" className="kd-tag-add" onClick={handleStartAddingTag}>
                <Hash size={11} strokeWidth={1.8} aria-hidden="true" />
                Add tag
              </button>
            )}
          </div>

          <div className="kd-body">
            <RichTextEditor
              ref={bodyEditorRef}
              value={content}
              onChange={handleContentChange}
              placeholder="Start writing… Select text to format it, or type # for a heading"
              spellCheck={settings.editor.spellcheck}
              ariaLabel="Record content"
            />
          </div>
        </article>
      </div>
    </div>
  );
});
