import { FC, useState, useEffect, useRef, KeyboardEvent } from "react";
import { PanelLeftClose, Plus, Search, Trash2, X } from "lucide-react";
import { KnowledgeRecordSummary, TagItem } from "./types";
import { stripMarkdownPreview } from "./markdownFormat.ts";

interface RecordListPanelProps {
  isOpen: boolean;
  onClose: () => void;
  records: KnowledgeRecordSummary[];
  activeRecordId: string | null;
  onSelectRecord: (id: string) => void;
  onCreateNewRecord: () => void;
  onSearch: (query: string) => void;
  tags: TagItem[];
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
  isLoading: boolean;
  /** Bumped when the shell asks to search; focuses the search field. */
  searchFocusToken?: number;
  /** Ask to delete a record (the desk shows its confirmation dialog). */
  onDeleteRecord?: (id: string) => void;
}

const formatRowDate = (isoString: string): string => {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], sameYear ? { month: "short", day: "numeric" } : { month: "short", year: "numeric" });
};

export const RecordListPanel: FC<RecordListPanelProps> = ({
  isOpen,
  onClose,
  records,
  activeRecordId,
  onSelectRecord,
  onCreateNewRecord,
  onSearch,
  tags,
  selectedTag,
  onSelectTag,
  isLoading,
  searchFocusToken = 0,
  onDeleteRecord,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Only an explicit search request steals focus; opening the docked library
  // must never pull the caret out of the page being written.
  useEffect(() => {
    if (isOpen && searchFocusToken > 0) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [isOpen, searchFocusToken]);

  // Debounced search dispatch to backend
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(searchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, onSearch]);

  useEffect(() => {
    setFocusedIndex((prev) => Math.min(prev, records.length - 1));
  }, [records.length]);

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const isButton = e.target instanceof HTMLButtonElement;
    if (e.key === "Escape") {
      if (searchQuery) {
        e.preventDefault();
        setSearchQuery("");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => Math.min(prev + 1, records.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && !isButton && records[focusedIndex]) {
      e.preventDefault();
      onSelectRecord(records[focusedIndex].id);
    }
  };

  return (
    <aside
      className={`kd-library ${isOpen ? "is-open" : ""}`}
      aria-label="Library"
      aria-hidden={!isOpen}
      onKeyDown={handleKeyDown}
    >
      {isOpen && (
        <>
          <div className="kd-library-head">
            <span className="kd-panel-title">
              Library <span className="kd-count" data-count>{records.length}</span>
            </span>
            <div className="kd-library-actions">
              <button
                type="button"
                className="kd-icon kd-icon-sm"
                onClick={onCreateNewRecord}
                title="New record (Ctrl+N)"
                aria-label="New record"
              >
                <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="kd-icon kd-icon-sm"
                onClick={onClose}
                title="Hide library"
                aria-label="Hide library"
              >
                <PanelLeftClose size={14} strokeWidth={1.6} aria-hidden="true" />
              </button>
            </div>
          </div>

          <label className="kd-search">
            <Search size={13} strokeWidth={1.7} aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search records"
            />
            {searchQuery && (
              <button type="button" className="kd-search-clear" onClick={() => setSearchQuery("")} aria-label="Clear search">
                <X size={11} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </label>

          {tags.length > 0 && (
            <div className="kd-tag-filter" role="group" aria-label="Filter by tag">
              <button
                type="button"
                className={selectedTag === null ? "is-active" : ""}
                onClick={() => onSelectTag(null)}
              >
                All
              </button>
              {tags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={selectedTag === t.name ? "is-active" : ""}
                  onClick={() => onSelectTag(selectedTag === t.name ? null : t.name)}
                >
                  #{t.name}
                  <span className="tag-count">{t.count}</span>
                </button>
              ))}
            </div>
          )}

          <div className="kd-library-list" role="listbox" aria-label="Records">
            {isLoading ? (
              <p className="kd-panel-empty">Loading…</p>
            ) : records.length === 0 ? (
              <p className="kd-panel-empty">
                {searchQuery || selectedTag ? "No matches." : "No records yet. Press + to start one."}
              </p>
            ) : (
              records.map((r, idx) => {
                const isSelected = r.id === activeRecordId;
                return (
                  <div
                    key={r.id}
                    role="option"
                    tabIndex={-1}
                    aria-selected={isSelected}
                    className={`kd-row ${isSelected ? "is-selected" : ""} ${idx === focusedIndex ? "is-focused" : ""}`}
                    onClick={() => onSelectRecord(r.id)}
                  >
                    <div className="kd-row-top">
                      <span className="kd-row-title">{r.title.trim() || "Untitled"}</span>
                      <time className="kd-row-date" dateTime={r.updated_at}>
                        {formatRowDate(r.updated_at)}
                      </time>
                      {onDeleteRecord && (
                        <button
                          type="button"
                          className="kd-row-delete"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteRecord(r.id);
                          }}
                          title={`Delete "${r.title.trim() || "Untitled"}"`}
                          aria-label={`Delete ${r.title.trim() || "Untitled"}`}
                        >
                          <Trash2 size={12} strokeWidth={1.8} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {r.preview && <p className="kd-row-preview">{stripMarkdownPreview(r.preview)}</p>}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </aside>
  );
};
