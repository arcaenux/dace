import { FC, useState, useEffect, useCallback, useRef } from "react";
import { KnowledgeRecord, KnowledgeRecordSummary, TagItem } from "./types";
import * as api from "./knowledgeApi";
import { pickAndImportAttachment } from "../attachments/attachmentsApi";
import { RecordEditor, RecordEditorHandle } from "./RecordEditor";
import { RecordListPanel } from "./RecordListPanel";
import { KnowledgeContextPanel, extractDeskOutline, DeskOutlineItem } from "./KnowledgeContextPanel";
import { useFocusSpace } from "../focus/FocusSpaceContext";
import { useDismissable } from "../core/useDismissable";
import { useSettings } from "../settings/SettingsContext";
import type { KnowledgeDeskIntent } from "../core/appIntents.ts";
import type { SaveParticipantRegistry } from "../core/saveRegistry.ts";

interface KnowledgeDeskProps {
  onShowNotice: (msg: string) => void;
  initialRecordId?: string | null;
  intent?: KnowledgeDeskIntent | null;
  onConsumeIntent?: (intentId: string) => void;
  saveRegistry: SaveParticipantRegistry;
  onOpenInReader?: (attachmentId: string, pageNumber: number) => void;
  onOpenGraphView?: () => void;
}

export const KnowledgeDesk: FC<KnowledgeDeskProps> = ({
  onShowNotice,
  initialRecordId,
  intent,
  onConsumeIntent,
  saveRegistry,
  onOpenInReader,
  onOpenGraphView,
}) => {
  const [records, setRecords] = useState<KnowledgeRecordSummary[]>([]);
  const [activeRecord, setActiveRecord] = useState<KnowledgeRecord | null>(null);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isListOpen, setIsListOpen] = useState<boolean>(false);
  const [isContextPanelOpen, setIsContextPanelOpen] = useState<boolean>(() => {
    if (typeof window !== "undefined" && window.location.hash.includes("context=collapsed")) {
      return false;
    }
    return true;
  });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const { settings } = useSettings();

  // Navigation History Stack for Relationship Back-Tracking
  const [navigationHistory, setNavigationHistory] = useState<string[]>([]);
  const [outline, setOutline] = useState<DeskOutlineItem[]>([]);

  const editorRef = useRef<RecordEditorHandle>(null);
  const outlineSignatureRef = useRef<string>("");
  const isSwitchingRef = useRef<boolean>(false);
  const pendingSwitchTargetRef = useRef<string | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const handledIntentIdsRef = useRef<Set<string>>(new Set());

  // The shell owns app close; this surface only reports its save state.
  useEffect(() => {
    const unregister = saveRegistry.register({
      isDirty: () => editorRef.current?.isDirty() ?? false,
      isSaving: () => editorRef.current?.isSaving() ?? false,
      flush: async () => (await editorRef.current?.flushSave()) ?? true,
    });
    return unregister;
  }, [saveRegistry]);

  useDismissable(
    deleteConfirmId !== null,
    () => setDeleteConfirmId(null),
    deleteDialogRef,
    { group: "desk-dialog", autoFocus: true }
  );
  const { isFocusSpace } = useFocusSpace();

  // The Outline view is derived only from headings that actually exist in the
  // active record; a signature guard avoids re-rendering on every keystroke.
  const handleContentSnapshot = useCallback((content: string) => {
    const items = extractDeskOutline(content);
    const signature = JSON.stringify(items);
    if (signature !== outlineSignatureRef.current) {
      outlineSignatureRef.current = signature;
      setOutline(items);
    }
  }, []);

  useEffect(() => {
    if (activeRecord) {
      handleContentSnapshot(activeRecord.content);
    } else {
      outlineSignatureRef.current = "";
      setOutline([]);
    }
  }, [activeRecord?.id, activeRecord?.content, handleContentSnapshot]);

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
        const targetId = initialRecordId || (list.length > 0 ? list[0].id : null);
        if (targetId) {
          const full = await api.getRecord(targetId);
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
  }, [loadRecords, refreshTags, initialRecordId]);

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

  // Handle switching to a specific record if initialRecordId prop updates while mounted
  useEffect(() => {
    if (initialRecordId && initialRecordId !== activeRecord?.id) {
      handleSelectRecord(initialRecordId);
    }
  }, [initialRecordId, activeRecord?.id, handleSelectRecord]);

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
    const deletedId = deleteConfirmId;

    try {
      const success = await api.deleteRecord(deletedId);
      if (success) {
        window.dispatchEvent(new CustomEvent("dace:record-deleted", { detail: deletedId }));
        onShowNotice("Record deleted");
        setDeleteConfirmId(null);
        setNavigationHistory((prev) => prev.filter((id) => id !== deletedId));
        const list = await loadRecords(selectedTag);
        await refreshTags();

        // Switch to adjacent record or clear
        if (activeRecord?.id === deletedId) {
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
      onShowNotice("Error deleting record from library");
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

  // Shell-owned intents from the command palette, shortcuts, and top bar.
  useEffect(() => {
    if (!intent || handledIntentIdsRef.current.has(intent.id)) return;
    handledIntentIdsRef.current.add(intent.id);
    onConsumeIntent?.(intent.id);

    if (intent.type === "new-record") {
      handleCreateNewRecord();
      return;
    }

    if (intent.type === "search-records") {
      setIsListOpen(true);
      return;
    }

    if (intent.type === "save-active") {
      void (async () => {
        const saved = await editorRef.current?.flushSave();
        if (saved === false) onShowNotice("Save failed — see the save status in the editor");
      })();
      return;
    }

    void (async () => {
      try {
        const res = await pickAndImportAttachment(activeRecord?.id);
        if (res) {
          onShowNotice(`Imported "${res.attachment.file_name}" into managed storage.`);
          if (settings.documents.openImportedDocuments) {
            onOpenInReader?.(res.attachment.id, 1);
          }
        }
      } catch (err: any) {
        onShowNotice(`Import failed: ${err?.message || err}`);
      }
    })();
  }, [
    intent,
    onConsumeIntent,
    handleCreateNewRecord,
    activeRecord?.id,
    onShowNotice,
    settings.documents.openImportedDocuments,
    onOpenInReader,
  ]);

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
          <div className="desk-workspace">
            <RecordEditor
              ref={editorRef}
              key={activeRecord.id}
              record={activeRecord}
              onSaveRecord={handleSaveRecord}
              onDeleteRecord={(id) => setDeleteConfirmId(id)}
              isFocusSpace={isFocusSpace}
              onToggleRecordList={() => setIsListOpen((prev) => !prev)}
              isListOpen={isListOpen}
              onContentChange={handleContentSnapshot}
              canNavigateBack={navigationHistory.length > 0}
              onNavigateBack={handleNavigateBack}
              previousRecordTitle={previousRecordTitle}
              isContextOpen={isContextPanelOpen}
              onToggleContext={() => setIsContextPanelOpen((prev) => !prev)}
            />
            <KnowledgeContextPanel
              record={activeRecord}
              outline={outline}
              isFocusSpace={isFocusSpace}
              onNavigateToRecord={handleNavigateToRecord}
              onShowNotice={onShowNotice}
              onOpenExcerptInReader={onOpenInReader}
              onJumpToLine={(line) => editorRef.current?.jumpToLine(line)}
              onOpenFullGraph={onOpenGraphView}
              isOpen={isContextPanelOpen}
            />
          </div>
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
          <div ref={deleteDialogRef} className="delete-confirm-dialog">
            <h3 className="confirm-title">Delete Knowledge Record?</h3>
            <p className="confirm-message">
              This record will be permanently deleted from your library. This action cannot be undone.
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

    </div>
  );
};