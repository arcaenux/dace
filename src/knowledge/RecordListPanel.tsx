import { FC, useState, useEffect, useRef, KeyboardEvent } from "react";
import { KnowledgeRecordSummary, TagItem } from "./types";

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
}

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
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus search input when panel opens
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Debounced search dispatch to backend
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(searchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, onSearch]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => Math.min(prev + 1, records.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && records[focusedIndex]) {
      e.preventDefault();
      onSelectRecord(records[focusedIndex].id);
    }
  };

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <aside
      className={`record-list-panel ${isOpen ? "open" : ""}`}
      aria-label="Knowledge Records Navigation"
      onKeyDown={handleKeyDown}
    >
      {/* Panel Header */}
      <div className="record-panel-header">
        <div className="record-panel-title-row">
          <span className="record-panel-title">Knowledge Records</span>
          <div className="record-panel-actions">
            <button
              className="desk-btn primary"
              onClick={onCreateNewRecord}
              title="Create new knowledge record (Ctrl+N)"
            >
              <span>+ New</span>
            </button>
            <button
              className="panel-close-btn"
              onClick={onClose}
              title="Close records panel (Esc)"
              aria-label="Close records panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="record-search-box">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="search-icon">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            className="record-search-input"
            placeholder="Search records in SQLite..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="clear-search-btn"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              &times;
            </button>
          )}
        </div>

        {/* Tag Filter Chips */}
        {tags.length > 0 && (
          <div className="record-tag-filter-bar">
            <button
              className={`tag-chip ${selectedTag === null ? "active" : ""}`}
              onClick={() => onSelectTag(null)}
            >
              All
            </button>
            {tags.map((t) => (
              <button
                key={t.id}
                className={`tag-chip ${selectedTag === t.name ? "active" : ""}`}
                onClick={() => onSelectTag(selectedTag === t.name ? null : t.name)}
              >
                #{t.name} <span className="tag-count">{t.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Record List */}
      <div className="record-list-scroll" ref={listRef} role="listbox">
        {isLoading ? (
          <div className="record-list-empty">Loading records...</div>
        ) : records.length === 0 ? (
          <div className="record-list-empty">
            {searchQuery || selectedTag
              ? "No records matching query."
              : "No knowledge records yet. Click '+ New' to create one."}
          </div>
        ) : (
          records.map((r, idx) => {
            const isSelected = r.id === activeRecordId;
            const isFocused = idx === focusedIndex;
            return (
              <div
                key={r.id}
                role="option"
                aria-selected={isSelected}
                className={`record-card-item ${isSelected ? "selected" : ""} ${isFocused ? "focused" : ""}`}
                onClick={() => onSelectRecord(r.id)}
              >
                <div className="card-top">
                  <span className="card-title">{r.title || "Untitled Record"}</span>
                  <span className="card-date">{formatDate(r.updated_at)}</span>
                </div>
                {r.preview && <p className="card-preview">{r.preview}</p>}
                {r.tags.length > 0 && (
                  <div className="card-tags">
                    {r.tags.map((t) => (
                      <span key={t} className="card-tag">#{t}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
