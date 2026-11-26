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
  Bold,
  Code,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Quote,
  Strikethrough,
  X,
  type LucideIcon,
} from "lucide-react";
import { applyMarkdownFormat, formatActionForShortcut, type FormatAction } from "./markdownFormat.ts";
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

const FORMAT_GROUPS: { action: FormatAction; label: string; icon: LucideIcon; hint?: string }[][] = [
  [
    { action: "h1", label: "Heading 1", icon: Heading1 },
    { action: "h2", label: "Heading 2", icon: Heading2 },
    { action: "h3", label: "Heading 3", icon: Heading3 },
  ],
  [
    { action: "bold", label: "Bold", icon: Bold, hint: "Ctrl+B" },
    { action: "italic", label: "Italic", icon: Italic, hint: "Ctrl+I" },
    { action: "strike", label: "Strikethrough", icon: Strikethrough, hint: "Ctrl+Shift+X" },
    { action: "code", label: "Inline code", icon: Code, hint: "Ctrl+E" },
    { action: "link", label: "Link", icon: Link },
  ],
  [
    { action: "bullet", label: "Bulleted list", icon: List },
    { action: "numbered", label: "Numbered list", icon: ListOrdered },
    { action: "task", label: "Checklist", icon: ListChecks },
    { action: "quote", label: "Quote", icon: Quote },
    { action: "divider", label: "Divider", icon: Minus },
  ],
];

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
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
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
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(offset, offset + (lines[target - 1]?.length || 0));

    // The body grows with its content and the page scrolls, so measure where
    // the line really sits (soft-wrapped lines included) with a mirror element.
    const scroller = scrollAreaRef.current;
    if (!scroller) return;
    const style = window.getComputedStyle(textarea);
    const mirror = document.createElement("div");
    for (const prop of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingLeft", "paddingRight", "paddingTop", "boxSizing"] as const) {
      mirror.style[prop] = style[prop];
    }
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.overflowWrap = "break-word";
    mirror.style.width = `${textarea.clientWidth}px`;
    mirror.textContent = textarea.value.slice(0, offset) || " ";
    document.body.appendChild(mirror);
    const lineHeight = parseFloat(style.lineHeight) || 26;
    const caretY = mirror.offsetHeight - lineHeight;
    mirror.remove();

    const textareaTop =
      textarea.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({ top: Math.max(0, textareaTop + caretY - scroller.clientHeight / 3) });
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

  // Apply a formatting action as one native edit so Ctrl+Z still works.
  const applyFormat = (action: FormatAction) => {
    const textarea = bodyTextareaRef.current;
    if (!textarea) return;
    const edit = applyMarkdownFormat(textarea.value, textarea.selectionStart, textarea.selectionEnd, action);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(edit.start, edit.end);
    const inserted =
      typeof document.execCommand === "function" && document.execCommand("insertText", false, edit.insert);
    if (!inserted) {
      textarea.setRangeText(edit.insert, edit.start, edit.end, "end");
      handleContentChange(textarea.value);
    }
    textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
  };

  const handleBodyKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const modifier = e.ctrlKey || e.metaKey;
    if (!modifier || e.altKey) return;
    const action = formatActionForShortcut(e.key, e.shiftKey);
    if (!action) return;
    e.preventDefault();
    applyFormat(action);
  };

  // The body grows with its content so the whole page scrolls as one sheet.
  useLayoutEffect(() => {
    const textarea = bodyTextareaRef.current;
    const scroller = scrollAreaRef.current;
    if (!textarea) return;
    const keep = scroller?.scrollTop ?? 0;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    if (scroller) scroller.scrollTop = keep;
  }, [content]);

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

        <div className="kd-format" role="toolbar" aria-label="Formatting">
          {FORMAT_GROUPS.map((group, groupIndex) => (
            <div className="kd-format-group" key={groupIndex}>
              {group.map(({ action, label, icon: Icon, hint }) => (
                <button
                  key={action}
                  type="button"
                  className="kd-icon kd-icon-sm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyFormat(action)}
                  title={hint ? `${label} (${hint})` : label}
                  aria-label={label}
                >
                  <Icon size={14} strokeWidth={1.7} aria-hidden="true" />
                </button>
              ))}
            </div>
          ))}
        </div>

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
                bodyTextareaRef.current?.focus();
              }
            }}
            aria-label="Record title"
          />

          <div className={`kd-tags ${tags.length === 0 && !isAddingTag ? "is-empty" : ""}`}>
            {tags.map((t) => (
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

          <textarea
            ref={bodyTextareaRef}
            className="kd-body"
            placeholder={
              settings.editor.defaultFormat === "markdown"
                ? "Start writing… Markdown works: # heading, - list, **bold**"
                : "Start writing…"
            }
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            onKeyDown={handleBodyKeyDown}
            spellCheck={settings.editor.spellcheck}
            aria-label="Record content"
          />
        </article>
      </div>
    </div>
  );
});
