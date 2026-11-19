import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import { AttachmentSummary } from "../attachments/types.ts";
import * as knowledgeApi from "../knowledge/knowledgeApi.ts";
import { Highlight } from "./types.ts";
import {
  excerptFromHighlight,
  formatExcerptBlock,
  parseNoteExcerpts,
} from "./noteExcerpts.ts";

export type ReaderNoteSaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

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
  flushSave: () => Promise<void>;
  insertMarkdown: (prefix: string, suffix?: string) => void;
  contentRef: RefObject<HTMLTextAreaElement | null>;
}

const noteKey = (attachmentId: string) => `dace:reader-note:${attachmentId}`;
const AUTOSAVE_DELAY = 900;

const emptyState = (): ReaderNoteState => ({
  recordId: null,
  title: "",
  content: "",
  tags: [],
  saveStatus: "idle",
  error: null,
});

export function useReaderNote(attachment: AttachmentSummary | null): ReaderNoteApi {
  const [state, setState] = useState<ReaderNoteState>(emptyState);
  const stateRef = useRef(state);
  const dirtyRef = useRef(false);
  const readyRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const clearTimer = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const saveNow = useCallback(async () => {
    const snapshot = stateRef.current;
    if (!snapshot.recordId || !dirtyRef.current) return;
    clearTimer();
    dirtyRef.current = false;
    setState((current) => ({ ...current, saveStatus: "saving", error: null }));
    try {
      await knowledgeApi.updateRecord({
        id: snapshot.recordId,
        title: snapshot.title.trim() || "Untitled Record",
        content: snapshot.content,
        tags: snapshot.tags,
      });
      setState((current) => ({
        ...current,
        saveStatus: current.recordId === snapshot.recordId ? "saved" : current.saveStatus,
      }));
    } catch (err: any) {
      dirtyRef.current = true;
      setState((current) => ({
        ...current,
        saveStatus: "error",
        error: err?.message || "Could not save note",
      }));
    }
  }, [clearTimer]);

  useEffect(() => {
    if (!attachment) {
      readyRef.current = false;
      setState(emptyState());
      return;
    }

    let cancelled = false;
    readyRef.current = false;
    dirtyRef.current = false;
    clearTimer();
    setState({ ...emptyState(), saveStatus: "saved" });

    async function loadNote() {
      try {
        const recordId = window.localStorage.getItem(noteKey(attachment!.id));
        if (!recordId) return;
        const record = await knowledgeApi.getRecord(recordId);
        if (cancelled || !record) return;
        setState({
          recordId: record.id,
          title: record.title,
          content: record.content,
          tags: record.tags,
          saveStatus: "saved",
          error: null,
        });
      } catch (err: any) {
        if (!cancelled) {
          setState({
            ...emptyState(),
            saveStatus: "error",
            error: err?.message || "Could not load note",
          });
        }
      } finally {
        if (!cancelled) readyRef.current = true;
      }
    }

    void loadNote();

    return () => {
      cancelled = true;
      readyRef.current = false;
      clearTimer();
      if (dirtyRef.current) void saveNow();
    };
  }, [attachment, clearTimer, saveNow]);

  useEffect(() => {
    if (!readyRef.current || !dirtyRef.current || !state.recordId) return;
    clearTimer();
    setState((current) => ({ ...current, saveStatus: "unsaved" }));
    saveTimerRef.current = window.setTimeout(() => {
      void saveNow();
    }, AUTOSAVE_DELAY);
    return clearTimer;
  }, [state.title, state.content, state.recordId, clearTimer, saveNow]);

  const startNote = useCallback(async () => {
    if (!attachment) return;
    if (stateRef.current.recordId) return;

    const title = `Notes — ${attachment.file_name}`;
    try {
      const record = await knowledgeApi.createRecord({
        title,
        content: "",
        tags: ["reader-note"],
      });
      window.localStorage.setItem(noteKey(attachment.id), record.id);
      readyRef.current = true;
      dirtyRef.current = false;
      setState({
        recordId: record.id,
        title: record.title,
        content: record.content,
        tags: record.tags,
        saveStatus: "saved",
        error: null,
      });
    } catch (err: any) {
      setState((current) => ({
        ...current,
        saveStatus: "error",
        error: err?.message || "Could not create note",
      }));
    }
  }, [attachment]);

  const setTitle = useCallback((title: string) => {
    dirtyRef.current = true;
    setState((current) => ({ ...current, title, saveStatus: "unsaved", error: null }));
  }, []);

  const setContent = useCallback((content: string) => {
    dirtyRef.current = true;
    setState((current) => ({ ...current, content, saveStatus: "unsaved", error: null }));
  }, []);

  const setTags = useCallback((tags: string[]) => {
    dirtyRef.current = true;
    setState((current) => ({ ...current, tags, saveStatus: "unsaved", error: null }));
  }, []);

  const insertExcerpt = useCallback(
    async (highlight: Highlight, documentTitle: string) => {
      if (!attachment) return "duplicate";
      if (!stateRef.current.recordId) await startNote();
      if (!stateRef.current.recordId) return "duplicate";

      const excerpt = excerptFromHighlight(highlight, documentTitle);
      const existing = parseNoteExcerpts(stateRef.current.content);
      const duplicate = existing.some(
        (item) =>
          item.id === highlight.id ||
          (item.page === highlight.page_number && item.text === highlight.selected_text)
      );
      if (duplicate) return "duplicate";

      const block = formatExcerptBlock(excerpt);
      dirtyRef.current = true;
      setState((current) => {
        const trimmed = current.content.replace(/\s+$/, "");
        const next = trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
        return { ...current, content: next, saveStatus: "unsaved", error: null };
      });
      return "inserted";
    },
    [attachment, startNote]
  );

  const insertMarkdown = useCallback((prefix: string, suffix = "") => {
    const element = contentRef.current;
    const current = stateRef.current.content;
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? current.length;
    const selected = current.slice(start, end);
    const next = `${current.slice(0, start)}${prefix}${selected}${suffix}${current.slice(end)}`;
    dirtyRef.current = true;
    setState((previous) => ({ ...previous, content: next, saveStatus: "unsaved", error: null }));
    window.setTimeout(() => {
      element?.focus();
      const cursor = start + prefix.length + selected.length;
      element?.setSelectionRange(cursor, cursor);
    }, 0);
  }, []);

  const flushSave = useCallback(async () => {
    await saveNow();
  }, [saveNow]);

  return {
    ...state,
    hasNote: Boolean(state.recordId),
    setTitle,
    setContent,
    setTags,
    startNote,
    insertExcerpt,
    flushSave,
    insertMarkdown,
    contentRef,
  };
}
