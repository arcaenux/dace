import { FC, useState, useEffect, useCallback } from "react";
import { KnowledgeRecord, KnowledgeRecordSummary, TagItem } from "./types";
import * as api from "./knowledgeApi";
import { RecordEditor } from "./RecordEditor";
import { RecordListPanel } from "./RecordListPanel";
import { useFocusSpace } from "../focus/FocusSpaceContext";

interface KnowledgeDeskProps {
  onShowNotice: (msg: string) => void;
}

export const KnowledgeDesk: FC<KnowledgeDeskProps> = ({ onShowNotice }) => {
  const [records, setRecords] = useState<KnowledgeRecordSummary[]>([]);
  const [activeRecord, setActiveRecord] = useState<KnowledgeRecord | null>(null);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isListOpen, setIsListOpen] = useState<boolean>(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const { isFocusSpace } = useFocusSpace();

  // Load tag list from SQLite
  const refreshTags = useCallback(async () => {
    try {
      const tagList = await api.listTags();
      setTags(tagList);
    } catch (err) {
      console.error("[KnowledgeDesk] Failed to load tags:", err);
    }
  }, []);

  // Load records list from SQLite
  const loadRecords = useCallback(async (tagFilter: string | null = null) => {
    setIsLoading(true);
    try {
      const list = await api.listRecords(tagFilter || undefined);
      setRecords(list);
      return list;
    } catch (err) {
      console.error("[KnowledgeDesk] Failed to load records from SQLite:", err);
      onShowNotice("Error reading from database");
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [onShowNotice]);

  // Initial load on mount
  useEffect(() => {
    let isMounted = true;

    async function init() {
      const list = await loadRecords(null);
      await refreshTags();

      if (isMounted) {
        if (list.length > 0) {
          // Open the most recently updated record
          const full = await api.getRecord(list[0].id);
          if (full && isMounted) {
            setActiveRecord(full);
          }
        }
      }
    }

    init();
    return () => {
      isMounted = false;
    };
  }, [loadRecords, refreshTags]);

  // Select a record to edit
  const handleSelectRecord = async (id: string) => {
    try {
      const rec = await api.getRecord(id);
      if (rec) {
        setActiveRecord(rec);
      }
    } catch (err) {
      console.error("[KnowledgeDesk] Failed to get record:", err);
      onShowNotice("Failed to load record from database");
    }
  };

  // Create a brand new record
  const handleCreateNewRecord = async () => {
    try {
      const created = await api.createRecord({
        title: "",
        content: "",
        tags: selectedTag ? [selectedTag] : [],
      });
      setActiveRecord(created);
      await loadRecords(selectedTag);
      await refreshTags();
      onShowNotice("Created new knowledge record");
    } catch (err) {
      console.error("[KnowledgeDesk] Failed to create record:", err);
      onShowNotice("Error creating record in database");
    }
  };

  // Save active record
  const handleSaveRecord = async (title: string, content: string, newTags: string[]) => {
    if (!activeRecord) return;

    const updated = await api.updateRecord({
      id: activeRecord.id,
      title,
      content,
      tags: newTags,
    });

    setActiveRecord(updated);

    // Refresh summaries list in background without disturbing active editing
    const summaries = await api.listRecords(selectedTag || undefined);
    setRecords(summaries);
    await refreshTags();
  };

  // Delete active record after confirmation
  const handleConfirmDelete = async () => {
    if (!deleteConfirmId) return;

    try {
      const success = await api.deleteRecord(deleteConfirmId);
      if (success) {
        onShowNotice("Record deleted");
        setDeleteConfirmId(null);
        const list = await loadRecords(selectedTag);
        await refreshTags();

        // Switch to adjacent record or clear
        if (activeRecord?.id === deleteConfirmId) {
          if (list.length > 0) {
            const next = await api.getRecord(list[0].id);
            setActiveRecord(next);
          } else {
            setActiveRecord(null);
          }
        }
      }
    } catch (err) {
      console.error("[KnowledgeDesk] Failed to delete record:", err);
      onShowNotice("Error deleting record from SQLite");
    }
  };

  // Search records in SQLite
  const handleSearch = useCallback(
    async (query: string) => {
      try {
        const results = await api.searchRecords(query);
        setRecords(results);
      } catch (err) {
        console.error("[KnowledgeDesk] Search error:", err);
      }
    },
    []
  );

  // Filter by tag
  const handleSelectTag = (tag: string | null) => {
    setSelectedTag(tag);
    loadRecords(tag);
  };

  // Global events from Command Palette or shortcuts
  useEffect(() => {
    const handleNewRecordEvent = () => {
      handleCreateNewRecord();
    };

    const handleSearchEvent = () => {
      setIsListOpen(true);
    };

    window.addEventListener("novadome:new-record", handleNewRecordEvent);
    window.addEventListener("novadome:search-records", handleSearchEvent);
    return () => {
      window.removeEventListener("novadome:new-record", handleNewRecordEvent);
      window.removeEventListener("novadome:search-records", handleSearchEvent);
    };
  }, []);

  return (
    <div className="knowledge-desk-layout">
      {/* 1. Collapsible Record Navigation Panel */}
      <RecordListPanel
        isOpen={isListOpen && !isFocusSpace}
        onClose={() => setIsListOpen(false)}
        records={records}
        activeRecordId={activeRecord?.id || null}
        onSelectRecord={(id) => {
          handleSelectRecord(id);
          setIsListOpen(false);
        }}
        onCreateNewRecord={handleCreateNewRecord}
        onSearch={handleSearch}
        tags={tags}
        selectedTag={selectedTag}
        onSelectTag={handleSelectTag}
        isLoading={isLoading}
      />

      {/* 2. Central Editor Area */}
      <div className="knowledge-main-area">
        {activeRecord ? (
          <RecordEditor
            record={activeRecord}
            onSaveRecord={handleSaveRecord}
            onDeleteRecord={(id) => setDeleteConfirmId(id)}
            isFocusSpace={isFocusSpace}
            onToggleRecordList={() => setIsListOpen(!isListOpen)}
            isListOpen={isListOpen}
          />
        ) : (
          <div className="desk-empty-state">
            <h2 className="desk-empty-heading">Knowledge Desk</h2>
            <p className="desk-empty-sub">
              No knowledge record is currently open. You can create a new record or browse existing notes.
            </p>
            <div className="desk-empty-actions">
              <button className="desk-btn primary" onClick={handleCreateNewRecord}>
                Create New Record
              </button>
              {records.length > 0 && (
                <button className="desk-btn" onClick={() => setIsListOpen(true)}>
                  Browse Records ({records.length})
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 3. Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div
          className="overlay-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Record Deletion"
        >
          <div className="delete-confirm-dialog">
            <h3 className="confirm-title">Delete Knowledge Record?</h3>
            <p className="confirm-message">
              This record will be permanently deleted from the SQLite database. This action cannot be undone.
            </p>
            <div className="confirm-actions">
              <button
                className="desk-btn"
                onClick={() => setDeleteConfirmId(null)}
              >
                Cancel
              </button>
              <button
                className="desk-btn danger-solid"
                onClick={handleConfirmDelete}
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
