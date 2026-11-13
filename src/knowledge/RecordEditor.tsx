import { FC, useState, useEffect, useRef, useCallback, KeyboardEvent } from "react";
import { KnowledgeRecord, SaveStatus } from "./types";

interface RecordEditorProps {
  record: KnowledgeRecord;
  onSaveRecord: (title: string, content: string, tags: string[]) => Promise<void>;
  onDeleteRecord: (id: string) => void;
  isFocusSpace: boolean;
  onToggleRecordList: () => void;
  isListOpen: boolean;
}

export const RecordEditor: FC<RecordEditorProps> = ({
  record,
  onSaveRecord,
  onDeleteRecord,
  isFocusSpace,
  onToggleRecordList,
  isListOpen,
}) => {
  const [title, setTitle] = useState(record.title);
  const [content, setContent] = useState(record.content);
  const [tags, setTags] = useState<string[]>(record.tags);
  const [tagInput, setTagInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const debounceTimerRef = useRef<number | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const hasPendingSaveRef = useRef<boolean>(false);
  const currentRecordIdRef = useRef<string>(record.id);

  // Sync internal state when active record changes
  useEffect(() => {
    // If switching between different records
    if (currentRecordIdRef.current !== record.id) {
      currentRecordIdRef.current = record.id;
      setTitle(record.title);
      setContent(record.content);
      setTags(record.tags);
      setTagInput("");
      setSaveStatus("saved");
      setErrorMessage(null);
    }
  }, [record.id, record.title, record.content, record.tags]);

  // Core persistence function
  const executeSave = useCallback(
    async (saveTitle: string, saveContent: string, saveTags: string[]) => {
      if (isSavingRef.current) {
        hasPendingSaveRef.current = true;
        return;
      }

      isSavingRef.current = true;
      setSaveStatus("saving");
      setErrorMessage(null);

      try {
        await onSaveRecord(saveTitle, saveContent, saveTags);
        setSaveStatus("saved");
      } catch (err) {
        setSaveStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Failed to persist record to SQLite");
      } finally {
        isSavingRef.current = false;
        if (hasPendingSaveRef.current) {
          hasPendingSaveRef.current = false;
          // Trigger any queued updates
          executeSave(title, content, tags);
        }
      }
    },
    [onSaveRecord, title, content, tags]
  );

  // Trigger debounced autosave when user edits
  const triggerAutosave = useCallback(
    (newTitle: string, newContent: string, newTags: string[]) => {
      setSaveStatus("unsaved");
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        executeSave(newTitle, newContent, newTags);
      }, 1200);
    },
    [executeSave]
  );

  // Explicit save (e.g. on Ctrl+S)
  const handleExplicitSave = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    executeSave(title, content, tags);
  }, [executeSave, title, content, tags]);

  // Expose explicit save to parent / global shortcut via listener
  useEffect(() => {
    const handleGlobalSaveRequest = (e: CustomEvent) => {
      if (e.detail?.recordId === record.id || !e.detail?.recordId) {
        handleExplicitSave();
      }
    };
    window.addEventListener("novadome:save-record" as any, handleGlobalSaveRequest);
    return () => {
      window.removeEventListener("novadome:save-record" as any, handleGlobalSaveRequest);
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [handleExplicitSave, record.id]);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    triggerAutosave(val, content, tags);
  };

  const handleContentChange = (val: string) => {
    setContent(val);
    triggerAutosave(title, val, tags);
  };

  const handleAddTag = () => {
    const clean = tagInput.trim().toLowerCase();
    if (clean && !tags.includes(clean)) {
      const updated = [...tags, clean];
      setTags(updated);
      setTagInput("");
      triggerAutosave(title, content, updated);
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const updated = tags.filter((t) => t !== tagToRemove);
    setTags(updated);
    triggerAutosave(title, content, updated);
  };

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      handleAddTag();
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      handleRemoveTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className={`editor-container ${isFocusSpace ? "in-focus" : ""}`}>
      {/* Top Bar / Meta Bar */}
      <div className="editor-meta-bar">
        <div className="editor-meta-left">
          {!isFocusSpace && (
            <button
              className={`desk-btn ${isListOpen ? "active" : ""}`}
              onClick={onToggleRecordList}
              title="Toggle Record Navigation (Esc closes)"
              aria-label="Toggle records list"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
              <span>Records</span>
            </button>
          )}

          {/* Save Status Indicator */}
          <div className="save-status-indicator" role="status" aria-live="polite">
            {saveStatus === "saved" && (
              <span className="status-saved" title="Changes saved to SQLite">
                <span className="status-dot green"></span> Saved
              </span>
            )}
            {saveStatus === "unsaved" && (
              <span className="status-unsaved" title="Unsaved changes pending autosave">
                <span className="status-dot amber"></span> Unsaved
              </span>
            )}
            {saveStatus === "saving" && (
              <span className="status-saving" title="Writing to SQLite database...">
                <span className="status-dot pulse"></span> Saving...
              </span>
            )}
            {saveStatus === "error" && (
              <span className="status-error" title={errorMessage || "Database write error"}>
                <span className="status-dot red"></span> Error saving
              </span>
            )}
          </div>
        </div>

        <div className="editor-meta-right">
          <button
            className="desk-btn"
            onClick={handleExplicitSave}
            title="Explicit Save (Ctrl+S)"
          >
            <span>Save</span>
            <kbd>Ctrl+S</kbd>
          </button>
          {!isFocusSpace && (
            <button
              className="desk-btn danger"
              onClick={() => onDeleteRecord(record.id)}
              title="Delete this record"
            >
              <span>Delete</span>
            </button>
          )}
        </div>
      </div>

      {/* Editor Content Area */}
      <div className="editor-scroll-area">
        <div className="editor-document">
          {/* Title Input */}
          <input
            className="editor-title-input"
            type="text"
            placeholder="Record Title..."
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            aria-label="Record Title"
          />

          {/* Tags Section */}
          <div className="editor-tags-wrapper">
            {tags.map((tag) => (
              <span key={tag} className="editor-tag-pill">
                #{tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="tag-remove-btn"
                  aria-label={`Remove tag ${tag}`}
                >
                  &times;
                </button>
              </span>
            ))}
            <input
              type="text"
              className="editor-tag-input"
              placeholder={tags.length === 0 ? "Add tags (press Enter)..." : "+ tag"}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={handleAddTag}
              aria-label="Add tags"
            />
          </div>

          {/* Multiline Body Textarea */}
          <textarea
            className="editor-textarea"
            placeholder="Write knowledge record (Markdown, atomic facts, concepts)..."
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            aria-label="Record Content"
          />
        </div>
      </div>
    </div>
  );
};
