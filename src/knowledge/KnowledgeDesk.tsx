import { FC, useState, useEffect, useCallback, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriEnvironment, closeNativeWindow } from "../focus/tauriWindow";
import { KnowledgeRecord, KnowledgeRecordSummary, TagItem } from "./types";
import * as api from "./knowledgeApi";
import { RecordEditor, RecordEditorHandle } from "./RecordEditor";
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

  // Close Coordination Modal State
  const [closeErrorModalOpen, setCloseErrorModalOpen] = useState<boolean>(false);
  const [closeErrorMessage, setCloseErrorMessage] = useState<string | null>(null);

  // Navigation History Stack for Relationship Back-Tracking
  const [navigationHistory, setNavigationHistory] = useState<string[]>([]);

  const editorRef = useRef<RecordEditorHandle>(null);
  const isSwitchingRef = useRef<boolean>(false);
  const pendingSwitchTargetRef = useRef<string | null>(null);

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
  const loadRecords = useCallback(
    async (tagFilter: string | null = null) => {
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
    },
    [onShowNotice]
  );

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

  // Window Close Coordination: prevents application close while persistence is pending or dirty
  useEffect(() => {
    if (!isTauriEnvironment()) return;

    let isClosing = false;
    let unlistenFn: (() => void) | null = null;

    async function initCloseHandler() {
      try {
        const appWin = getCurrentWindow();
        unlistenFn = await appWin.onCloseRequested(async (event) => {
          if (isClosing) {
            // Authorized close already in progress
            return;
          }

          const hasDirty = editorRef.current?.isDirty() ?? false;
          const hasInFlight = editorRef.current?.isSaving() ?? false;

          if (hasDirty || hasInFlight) {
            // Prevent immediate exit
            event.preventDefault();

            try {
              const saved = await editorRef.current?.flushSave();
              if (saved) {
                isClosing = true;
                if (unlistenFn) {
                  unlistenFn();
                  unlistenFn = null;
                }
                await closeNativeWindow();
              } else {
                setCloseErrorMessage("Database write error while saving active record.");
                setCloseErrorModalOpen(true);
              }
            } catch (err) {
              setCloseErrorMessage(
                err instanceof Error ? err.message : "Unexpected error while saving"
              );
              setCloseErrorModalOpen(true);
            }
          }
        });
      } catch (err) {
        console.error("[KnowledgeDesk] Failed to register onCloseRequested handler:", err);
      }
    }

    initCloseHandler();

    return () => {
      if (unlistenFn) {
        unlistenFn();
        unlistenFn = null;
      }
    };
  }, []);

  // Save active record with explicit recordId decoupling
  const handleSaveRecord = useCallback(
    async (
      recordId: string,
      title: string,
      content: string,
      newTags: string[]
    ): Promise<KnowledgeRecord> => {
      const updated = await api.updateRecord({
        id: recordId,
        title,
        content,
        tags: newTags,
      });

      // Only update activeRecord state if the saved record is still the one on screen
      setActiveRecord((current) => (current && current.id === recordId ? updated : current));

      // Refresh summaries list in background without disturbing active editing
      const summaries = await api.listRecords(selectedTag || undefined);
      setRecords(summaries);
      await refreshTags();

      return updated;
    },
    [refreshTags, selectedTag]
  );

  // Select a record to edit with strict switching protection
  const handleSelectRecord = useCallback(
    async (id: string) => {
      if (activeRecord?.id === id) return;

      pendingSwitchTargetRef.current = id;
      if (isSwitchingRef.current) {
        return;
      }

      isSwitchingRef.current = true;

      try {
        while (pendingSwitchTargetRef.current !== null) {
          const nextId = pendingSwitchTargetRef.current;
          pendingSwitchTargetRef.current = null;

          // 1. Flush any pending changes on the current record
          if (editorRef.current && (editorRef.current.isDirty() || editorRef.current.isSaving())) {
            const ok = await editorRef.current.flushSave();
            if (!ok) {
              onShowNotice("Could not save changes to active record. Switch cancelled to prevent data loss.");
              pendingSwitchTargetRef.current = null;
              break;
            }
          }

          // 2. Fetch the target record
          const rec = await api.getRecord(nextId);
          if (rec) {
            setActiveRecord(rec);
          } else {
            onShowNotice("Record not found.");
          }
        }
      } catch (err) {
        console.error("[KnowledgeDesk] Error switching record:", err);
        onShowNotice("Failed to switch records.");
      } finally {
        isSwitchingRef.current = false;
      }
    },
    [activeRecord?.id, onShowNotice]
  );

  // Navigate to a connected concept, preserving history
  const handleNavigateToRecord = useCallback(
    async (targetId: string) => {
      if (activeRecord && activeRecord.id !== targetId) {
        setNavigationHistory((prev) => [...prev, activeRecord.id]);
      }
      await handleSelectRecord(targetId);
    },
    [activeRecord, handleSelectRecord]
  );

  // Return to previous concept in history stack
  const handleNavigateBack = useCallback(async () => {
    if (navigationHistory.length === 0) return;
    const prevHistory = [...navigationHistory];
    const prevId = prevHistory.pop()!;
    setNavigationHistory(prevHistory);
    await handleSelectRecord(prevId);
  }, [navigationHistory, handleSelectRecord]);

  const previousRecordId =
    navigationHistory.length > 0 ? navigationHistory[navigationHistory.length - 1] : null;
  const previousRecordTitle = previousRecordId
    ? records.find((r) => r.id === previousRecordId)?.title || "Previous Concept"
    : null;

  // Create a brand new record after flushing any active dirty record
  const handleCreateNewRecord = useCallback(async () => {
    if (isSwitchingRef.current) return;
    isSwitchingRef.current = true;

    try {
      if (editorRef.current && (editorRef.current.isDirty() || editorRef.current.isSaving())) {
        const ok = await editorRef.current.flushSave();
        if (!ok) {
          onShowNotice("Could not save changes to active record. Creation cancelled to prevent data loss.");
          return;
        }
      }

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
    } finally {
      isSwitchingRef.current = false;
    }
  }, [loadRecords, onShowNotice, refreshTags, selectedTag]);

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
  }, [handleCreateNewRecord]);

  return (
    <div className="knowledge-desk-root">
      {/* 1. Record Navigation Drawer / Panel */}
      <RecordListPanel
        isOpen={isListOpen}
        onClose={() => setIsListOpen(false)}
        records={records}
        activeRecordId={activeRecord?.id || null}
        onSelectRecord={handleSelectRecord}
        onCreateNewRecord={handleCreateNewRecord}
        onSearch={handleSearch}
        tags={tags}
        selectedTag={selectedTag}
        onSelectTag={handleSelectTag}
        isLoading={isLoading}
      />

      {/* 2. Main Writing / Record Area */}
      <div className="knowledge-main-area">
        {activeRecord ? (
          <RecordEditor
            ref={editorRef}
            key={activeRecord.id}
            record={activeRecord}
            onSaveRecord={handleSaveRecord}
            onDeleteRecord={(id) => setDeleteConfirmId(id)}
            isFocusSpace={isFocusSpace}
            onToggleRecordList={() => setIsListOpen((prev) => !prev)}
            isListOpen={isListOpen}
            onNavigateToRecord={handleNavigateToRecord}
            onShowNotice={onShowNotice}
            canNavigateBack={navigationHistory.length > 0}
            onNavigateBack={handleNavigateBack}
            previousRecordTitle={previousRecordTitle}
          />
        ) : (
          <div className="desk-empty-state">
            <h2 className="desk-empty-heading">Knowledge Desk</h2>
            <p className="desk-empty-sub">
              A quiet space for capturing thoughts, structured concepts, and personal research.
            </p>
            <div className="desk-empty-actions">
              <button className="desk-btn primary" onClick={handleCreateNewRecord}>
                + Create First Record
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
                type="button"
                className="desk-btn"
                onClick={() => setDeleteConfirmId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="desk-btn danger-solid"
                onClick={handleConfirmDelete}
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Shutdown Save Error Modal with Clear Retry Options */}
      {closeErrorModalOpen && (
        <div
          className="overlay-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Unsaved Changes on Close"
        >
          <div className="delete-confirm-dialog">
            <h3 className="confirm-title">Unsaved Changes</h3>
            <p className="confirm-message">
              {closeErrorMessage || "An error occurred while saving your record to SQLite."}
              <br />
              Closing now will cause recent changes to be lost. What would you like to do?
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="desk-btn"
                onClick={() => setCloseErrorModalOpen(false)}
              >
                Keep Editing
              </button>
              <button
                type="button"
                className="desk-btn danger"
                onClick={async () => {
                  setCloseErrorModalOpen(false);
                  await closeNativeWindow();
                }}
              >
                Discard & Close
              </button>
              <button
                type="button"
                className="desk-btn primary"
                onClick={async () => {
                  const ok = await editorRef.current?.flushSave();
                  if (ok) {
                    setCloseErrorModalOpen(false);
                    await closeNativeWindow();
                  } else {
                    onShowNotice("Retry failed. Please check database connectivity.");
                  }
                }}
              >
                Retry Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};