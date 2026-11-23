import {
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AttachmentSummary } from "../attachments/types.ts";
import * as knowledgeApi from "../knowledge/knowledgeApi.ts";
import type { KnowledgeRecord } from "../knowledge/types.ts";
import { useSettings } from "../settings/SettingsContext";
import { resolveReaderAutosaveDelayMs } from "./readerAutosave.ts";
import { Highlight } from "./types.ts";
import {
  appendExcerptToContent,
  excerptFromHighlight,
  excerptMatches,
  parseNoteExcerpts,
  stripExcerptMarker,
} from "./noteExcerpts.ts";
import { NoteSaveTracker, readerNoteTag, withReaderNoteTag } from "./noteSaveState.ts";

export type ReaderNoteSaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";
export type ReaderNoteSaveResult = "saved" | "skipped" | "error";

export interface ReaderNoteState {
  recordId: string | null;
  title: string;
  content: string;
  tags: string[];
  saveStatus: ReaderNoteSaveStatus;
  error: string | null;
}

interface ReaderNoteApi extends ReaderNoteState {
  hasNote: boolean;
  setTitle: (title: string) => void;
  setContent: (content: string) => void;
  setTags: (tags: string[]) => void;
  startNote: () => Promise<void>;
  insertExcerpt: (
    highlight: Highlight,
    documentTitle: string
  ) => Promise<"inserted" | "duplicate">;
  removeExcerpt: (excerptId: string) => void;
  flushSave: () => Promise<ReaderNoteSaveResult>;
  isDirty: () => boolean;
  isSaving: () => boolean;
  insertMarkdown: (prefix: string, suffix?: string) => void;
  contentRef: RefObject<HTMLTextAreaElement | null>;
}

interface ReaderNoteOptions {
  onSaveError?: (message: string) => void;
}

const noteKey = (attachmentId: string) => `dace:reader-note:${attachmentId}`;
const MAX_FLUSH_ROUNDS = 8;

const emptyState = (): ReaderNoteState => ({
  recordId: null,
  title: "",
  content: "",
  tags: [],
  saveStatus: "idle",
  error: null,
});

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "Could not save note";

export function useReaderNote(
  attachment: AttachmentSummary | null,
  options: ReaderNoteOptions = {}
): ReaderNoteApi {
  const [state, setState] = useState<ReaderNoteState>(emptyState);
  const { settings } = useSettings();
  const autosaveDelayMs = resolveReaderAutosaveDelayMs(settings);
  const stateRef = useRef(state);
  const noteAttachmentRef = useRef<string | null>(null);
  const trackerRef = useRef<NoteSaveTracker>(new NoteSaveTracker());
  const dirtyTimerRef = useRef<number | null>(null);
  const inFlightRef = useRef<Promise<ReaderNoteSaveResult> | null>(null);
  const scheduleSaveRef = useRef<() => void>(() => {});
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const selectionRequestRef = useRef<{ start: number; end: number } | null>(null);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const onSaveErrorRef = useRef(options.onSaveError);
  onSaveErrorRef.current = options.onSaveError;

  const applyState = useCallback((next: ReaderNoteState) => {
    // Keep the ref ahead of React so an immediate save always sees the newest
    // keystroke, even before the next render commits.
    stateRef.current = next;
    setState(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (dirtyTimerRef.current !== null) {
      window.clearTimeout(dirtyTimerRef.current);
      dirtyTimerRef.current = null;
    }
  }, []);

  const captureSnapshot = useCallback(() => {
    const current = stateRef.current;
    if (!current.recordId) return null;
    return {
      recordId: current.recordId,
      title: current.title.trim() || "Untitled Record",
      content: current.content,
      tags: withReaderNoteTag(current.tags, noteAttachmentRef.current || ""),
    };
  }, []);

  const enqueueSave = useCallback(
    (snapshot: NonNullable<ReturnType<typeof captureSnapshot>>, version: number) => {
      const previous = inFlightRef.current || Promise.resolve<ReaderNoteSaveResult>("skipped");
      const task = previous
        .catch(() => "skipped" as const)
        .then(async (): Promise<ReaderNoteSaveResult> => {
          try {
            applyState({ ...stateRef.current, saveStatus: "saving", error: null });
            await knowledgeApi.updateRecord({
              id: snapshot.recordId,
              title: snapshot.title,
              content: snapshot.content,
              tags: snapshot.tags,
            });

            if (trackerRef.current.commit(version, stateRef.current.recordId, snapshot.recordId)) {
              if (trackerRef.current.hasPending) {
                applyState({ ...stateRef.current, saveStatus: "unsaved" });
                scheduleSaveRef.current();
              } else {
                applyState({ ...stateRef.current, saveStatus: "saved", error: null });
              }
            }
            return "saved";
          } catch (err) {
            const message = errorMessage(err);
            if (stateRef.current.recordId === snapshot.recordId) {
              applyState({ ...stateRef.current, saveStatus: "error", error: message });
            }
            onSaveErrorRef.current?.(message);
            return "error";
          }
        });

      inFlightRef.current = task;
      void task.finally(() => {
        if (inFlightRef.current === task) inFlightRef.current = null;
      });
      return task;
    },
    [applyState]
  );

  const saveNow = useCallback((): Promise<ReaderNoteSaveResult> => {
    clearTimer();
    if (!trackerRef.current.hasPending) {
      return inFlightRef.current || Promise.resolve<ReaderNoteSaveResult>("skipped");
    }
    const snapshot = captureSnapshot();
    if (!snapshot) return Promise.resolve<ReaderNoteSaveResult>("skipped");
    return enqueueSave(snapshot, trackerRef.current.currentVersion);
  }, [captureSnapshot, clearTimer, enqueueSave]);

  const scheduleSave = useCallback(() => {
    clearTimer();
    dirtyTimerRef.current = window.setTimeout(() => {
      dirtyTimerRef.current = null;
      void saveNow();
    }, autosaveDelayMs);
  }, [autosaveDelayMs, clearTimer, saveNow]);
  scheduleSaveRef.current = scheduleSave;

  const markDirty = useCallback(
    (patch: Partial<ReaderNoteState>) => {
      trackerRef.current.markDirty();
      applyState({
        ...stateRef.current,
        ...patch,
        saveStatus: "unsaved",
        error: null,
      });
      scheduleSave();
    },
    [applyState, scheduleSave]
  );

  const loadNote = useCallback(
    async (target: AttachmentSummary, isCancelled: () => boolean) => {
      const attachmentId = target.id;
      noteAttachmentRef.current = attachmentId;
      trackerRef.current.reset();
      applyState({ ...emptyState(), saveStatus: "saved" });

      try {
        let recordId = window.localStorage.getItem(noteKey(attachmentId));
        let record: KnowledgeRecord | null = recordId ? await knowledgeApi.getRecord(recordId) : null;

        if ((!recordId || !record) && recordId) {
          window.localStorage.removeItem(noteKey(attachmentId));
          recordId = null;
        }

        if (!record) {
          // The tag is stored in SQLite and therefore survives in backups even
          // when webview localStorage does not.
          const tag = readerNoteTag(attachmentId);
          const summaries = await knowledgeApi.listRecords(tag);
          const match = summaries.find((candidate) => candidate.tags?.includes(tag)) || summaries[0];
          record = match ? await knowledgeApi.getRecord(match.id) : null;
          if (record) window.localStorage.setItem(noteKey(attachmentId), record.id);
        }

        if (isCancelled() || !record) return;
        trackerRef.current.markClean();
        applyState({
          recordId: record.id,
          title: record.title,
          content: record.content,
          tags: Array.isArray(record.tags) ? [...record.tags] : [],
          saveStatus: "saved",
          error: null,
        });
      } catch (err) {
        if (!isCancelled()) {
          applyState({
            ...emptyState(),
            saveStatus: "error",
            error: errorMessage(err),
          });
        }
      }
    },
    [applyState]
  );

  useEffect(() => {
    if (!attachment) {
      noteAttachmentRef.current = null;
      trackerRef.current.reset();
      applyState(emptyState());
      return;
    }

    let cancelled = false;
    void loadNote(attachment, () => cancelled);

    return () => {
      cancelled = true;
      clearTimer();
      if (trackerRef.current.hasPending) {
        void saveNow().then((result) => {
          if (result === "error") {
            onSaveErrorRef.current?.("Research note could not be saved before leaving the document");
          }
        });
      }
    };
  }, [attachment?.id, applyState, clearTimer, loadNote, saveNow]);

  useEffect(() => {
    const clearMapping = (event: Event) => {
      const recordId = (event as CustomEvent<string>).detail;
      if (recordId && stateRef.current.recordId === recordId) {
        const attachmentId = noteAttachmentRef.current;
        if (attachmentId) window.localStorage.removeItem(noteKey(attachmentId));
        trackerRef.current.reset();
        applyState(emptyState());
      }
    };
    window.addEventListener("dace:record-deleted", clearMapping);
    return () => window.removeEventListener("dace:record-deleted", clearMapping);
  }, [applyState]);

  useLayoutEffect(() => {
    const request = selectionRequestRef.current;
    if (!request) return;
    selectionRequestRef.current = null;
    const element = contentRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(request.start, request.end);
  }, [state.content]);

  const startNote = useCallback(async () => {
    if (!attachment || stateRef.current.recordId) return;
    if (startPromiseRef.current) return startPromiseRef.current;

    const attachmentId = attachment.id;
    const promise = (async () => {
      try {
        const record = await knowledgeApi.createRecord({
          title: `Notes — ${attachment.file_name}`,
          content: "",
          tags: ["reader-note", readerNoteTag(attachmentId)],
        });
        window.localStorage.setItem(noteKey(attachmentId), record.id);
        noteAttachmentRef.current = attachmentId;
        trackerRef.current.reset();
        trackerRef.current.markClean();
        applyState({
          recordId: record.id,
          title: record.title,
          content: record.content,
          tags: Array.isArray(record.tags) ? [...record.tags] : [],
          saveStatus: "saved",
          error: null,
        });
      } catch (err) {
        applyState({
          ...stateRef.current,
          saveStatus: "error",
          error: errorMessage(err),
        });
      }
    })();

    startPromiseRef.current = promise;
    try {
      await promise;
    } finally {
      startPromiseRef.current = null;
    }
  }, [applyState, attachment]);

  const setTitle = useCallback(
    (title: string) => markDirty({ title }),
    [markDirty]
  );

  const setContent = useCallback(
    (content: string) => markDirty({ content }),
    [markDirty]
  );

  const setTags = useCallback(
    (tags: string[]) =>
      markDirty({
        tags: withReaderNoteTag(tags, noteAttachmentRef.current || attachment?.id || ""),
      }),
    [attachment?.id, markDirty]
  );

  const insertExcerpt = useCallback(
    async (highlight: Highlight, documentTitle: string): Promise<"inserted" | "duplicate"> => {
      if (!attachment) return "duplicate";
      await startNote();
      if (!stateRef.current.recordId) return "duplicate";

      const excerpt = excerptFromHighlight(highlight, documentTitle);
      const existing = parseNoteExcerpts(stateRef.current.content);
      if (existing.some((item) => excerptMatches(item, excerpt))) return "duplicate";

      markDirty({
        content: appendExcerptToContent(stateRef.current.content, excerpt),
      });
      return "inserted";
    },
    [attachment, markDirty, startNote]
  );

  const removeExcerpt = useCallback(
    (excerptId: string) => {
      const content = stateRef.current.content;
      const next = stripExcerptMarker(content, excerptId);
      if (next !== content) markDirty({ content: next });
    },
    [markDirty]
  );

  const insertMarkdown = useCallback(
    (prefix: string, suffix = "") => {
      const element = contentRef.current;
      const current = stateRef.current.content;
      const start = element?.selectionStart ?? current.length;
      const end = element?.selectionEnd ?? current.length;
      const selected = current.slice(start, end);
      const next = `${current.slice(0, start)}${prefix}${selected}${suffix}${current.slice(end)}`;
      const cursor = start + prefix.length + selected.length;
      selectionRequestRef.current = { start: cursor, end: cursor };
      markDirty({ content: next });
    },
    [markDirty]
  );

  const flushSave = useCallback(async (): Promise<ReaderNoteSaveResult> => {
    clearTimer();
    let lastResult: ReaderNoteSaveResult = "skipped";
    let rounds = 0;

    // A save may already be in flight, and newer keystrokes may arrive while
    // it runs. Drain every pending version so the latest content is persisted.
    while ((trackerRef.current.hasPending || inFlightRef.current) && rounds < MAX_FLUSH_ROUNDS) {
      lastResult = await saveNow();
      rounds += 1;
      if (lastResult === "error") return "error";
    }

    if (trackerRef.current.hasPending || inFlightRef.current) {
      const message = "Research note did not finish saving; try again";
      onSaveErrorRef.current?.(message);
      return "error";
    }
    return lastResult;
  }, [clearTimer, saveNow]);

  const isDirty = useCallback(() => trackerRef.current.hasPending, []);
  const isSaving = useCallback(() => inFlightRef.current !== null, []);

  return useMemo(
    () => ({
      ...state,
      hasNote: Boolean(state.recordId),
      setTitle,
      setContent,
      setTags,
      startNote,
      insertExcerpt,
      removeExcerpt,
      flushSave,
      isDirty,
      isSaving,
      insertMarkdown,
      contentRef,
    }),
    [
      state,
      setTitle,
      setContent,
      setTags,
      startNote,
      insertExcerpt,
      removeExcerpt,
      flushSave,
      isDirty,
      isSaving,
      insertMarkdown,
    ]
  );
}
