import { FC, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AttachmentSummary, getViewerType } from "../attachments/types.ts";
import * as attApi from "../attachments/attachmentsApi.ts";
import * as readerApi from "./readerApi.ts";
import { Highlight, OutlineItem } from "./types.ts";
import { PdfViewer } from "./PdfViewer.tsx";
import { MarkdownReader } from "./MarkdownReader.tsx";
import { ReaderDrawer } from "./ReaderDrawer.tsx";
import { ReaderToolbar } from "./ReaderToolbar.tsx";
import { ReaderDivider } from "./ReaderDivider.tsx";
import { ConnectExcerptModal } from "./ConnectExcerptModal.tsx";
import { useAdaptiveReaderLayout } from "./useAdaptiveReaderLayout.ts";
import { useReaderNote } from "./useReaderNote.ts";
import { parseNoteExcerpts } from "./noteExcerpts.ts";
import { DEFAULT_SPLIT_RATIO, ReaderChromeState } from "./readerLayout.ts";
import {
  ensureReaderSession,
  getReaderSession,
  normalizeReaderSession,
  ReaderDrawerTab,
  saveReaderSession,
} from "./readerSession.ts";
import { visibleNoteTags } from "./noteSaveState.ts";
import type { ResearchReaderIntent } from "../core/appIntents.ts";
import type { SaveParticipantRegistry } from "../core/saveRegistry.ts";

interface ResearchReaderViewProps {
  initialAttachmentId?: string | null;
  initialPage?: number | null;
  intent?: ResearchReaderIntent | null;
  onConsumeIntent?: (intentId: string) => void;
  saveRegistry: SaveParticipantRegistry;
  onNavigateToRecord?: (recordId: string) => void;
  onShowNotice: (msg: string) => void;
  isFocusSpace?: boolean;
  onToggleFocus?: () => void;
  onChromeChange?: (chrome: ReaderChromeState) => void;
}

function outlineFromText(content: string): OutlineItem[] {
  const outline: OutlineItem[] = [];
  const stack: OutlineItem[] = [];

  content.split("\n").forEach((line) => {
    const match = /^(#{1,4})\s+(.+)$/.exec(line.trim());
    if (!match) return;
    const level = match[1].length;
    const item: OutlineItem = { title: match[2].trim(), pageNumber: 1, items: [] };
    if (level === 1) {
      outline.push(item);
      stack.length = 0;
      stack.push(item);
      return;
    }
    const parent = stack[Math.min(level - 2, stack.length - 1)];
    if (parent) {
      parent.items = parent.items || [];
      parent.items.push(item);
      stack[level - 1] = item;
      stack.length = level;
    } else {
      outline.push(item);
    }
  });

  return outline;
}

export const ResearchReaderView: FC<ResearchReaderViewProps> = ({
  initialAttachmentId,
  initialPage = 1,
  intent,
  onConsumeIntent,
  saveRegistry,
  onNavigateToRecord,
  onShowNotice,
  isFocusSpace = false,
  onToggleFocus,
  onChromeChange,
}) => {
  const [documents, setDocuments] = useState<AttachmentSummary[]>([]);
  const [activeAttachment, setActiveAttachment] = useState<AttachmentSummary | null>(null);
  const [isDocPickerOpen, setIsDocPickerOpen] = useState<boolean>(false);
  const docPickerRef = useRef<HTMLDivElement>(null);
  const docPickerTriggerRef = useRef<HTMLButtonElement>(null);

  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState<number>(initialPage || 1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [selectedHighlightId, setSelectedHighlightId] = useState<string | null>(null);
  const [annotationRequestId, setAnnotationRequestId] = useState<string | null>(null);

  const [drawerTab, setDrawerTab] = useState<ReaderDrawerTab>("highlights");
  const [connectHighlight, setConnectHighlight] = useState<Highlight | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [fitWidth, setFitWidth] = useState<boolean>(true);
  const [annotationType, setAnnotationType] = useState<Highlight["highlight_type"] | null>(null);

  const hydratedAttachmentRef = useRef<string | null>(null);
  const initialScrollTopRef = useRef(0);
  const initialWritingScrollTopRef = useRef(0);
  const handledIntentIdsRef = useRef<Set<string>>(new Set());

  const layout = useAdaptiveReaderLayout(onChromeChange);
  const setReaderMode = layout.setMode;
  const note = useReaderNote(activeAttachment, { onSaveError: onShowNotice });
  // Excerpt markers are scanned over the whole note. Defer that work so a
  // long document never blocks the keystroke that produced the update.
  const deferredNoteContent = useDeferredValue(note.content);
  const noteExcerpts = useMemo(
    () => parseNoteExcerpts(deferredNoteContent),
    [deferredNoteContent]
  );

  useEffect(() => {
    const unregister = saveRegistry.register({
      isDirty: () => note.isDirty(),
      isSaving: () => note.isSaving(),
      flush: async () => (await note.flushSave()) !== "error",
    });
    return unregister;
  }, [saveRegistry, note.isDirty, note.isSaving, note.flushSave]);

  const viewerType = activeAttachment
    ? getViewerType(activeAttachment.mime_type, activeAttachment.file_name)
    : "pdf";
  const effectiveOutline = useMemo(
    () => (viewerType === "pdf" ? outline : outlineFromText(textContent || "")),
    [viewerType, outline, textContent]
  );

  const loadDocuments = useCallback(async () => {
    try {
      const list = await attApi.listAllAttachments();
      setDocuments(list);
      setActiveAttachment((current) => {
        if (initialAttachmentId) return list.find((doc) => doc.id === initialAttachmentId) || list[0] || null;
        return current || list[0] || null;
      });
      if (list.length === 0) setIsLoading(false);
    } catch (err) {
      console.error("Failed to list library attachments:", err);
      onShowNotice("Could not load document library");
      setIsLoading(false);
    }
  }, [initialAttachmentId, onShowNotice]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  // Restore a per-document session whenever the active document changes.
  useEffect(() => {
    const attachmentId = activeAttachment?.id;
    if (!attachmentId || hydratedAttachmentRef.current === attachmentId) return;
    hydratedAttachmentRef.current = attachmentId;

    const session = normalizeReaderSession(getReaderSession(attachmentId));
    const deepLinkPage =
      initialAttachmentId === attachmentId && initialPage && initialPage > 0 ? initialPage : null;
    setCurrentPage(deepLinkPage || session.currentPage);
    setZoom(session.zoom);
    setFitWidth(session.fitWidth);
    setDrawerTab(session.drawerTab);
    setSelectedHighlightId(session.selectedHighlightId);
    initialScrollTopRef.current = session.scrollTop;
    initialWritingScrollTopRef.current = session.writingScrollTop;
  }, [activeAttachment?.id, initialAttachmentId, initialPage]);

  useEffect(() => {
    if (!activeAttachment) return;
    saveReaderSession(activeAttachment.id, {
      currentPage,
      zoom,
      fitWidth,
      drawerTab,
      selectedHighlightId,
    });
  }, [activeAttachment?.id, currentPage, zoom, fitWidth, drawerTab, selectedHighlightId]);

  useEffect(() => {
    if (!activeAttachment) return;
    let isMounted = true;
    setIsLoading(true);
    setLoadError(null);
    setDataUrl(null);
    setTextContent(null);
    setSelectedHighlightId(null);
    setAnnotationRequestId(null);
    setOutline([]);
    setTotalPages(1);

    async function loadContent() {
      try {
        const attachment = activeAttachment!;
        const type = getViewerType(attachment.mime_type, attachment.file_name);
        if (type === "markdown" || type === "text") {
          const text = await attApi.readAttachmentText(attachment.id);
          if (isMounted) setTextContent(text);
        } else if (type === "pdf") {
          const url = await attApi.readAttachmentDataUrl(attachment.id);
          if (isMounted) setDataUrl(url);
        } else {
          if (isMounted) setLoadError("This attachment type cannot be shown in the Research Reader.");
        }
        const savedHighlights = await readerApi.getAttachmentHighlights(attachment.id);
        if (isMounted) setHighlights(savedHighlights);
      } catch (err: any) {
        console.error("Failed to load document content:", err);
        if (isMounted) setLoadError(err?.message || "Failed to load document from storage");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadContent();
    return () => {
      isMounted = false;
    };
  }, [activeAttachment?.id]);

  const handleToggleFocus = useCallback(() => {
    onToggleFocus?.();
  }, [onToggleFocus]);

  const handleSaveNote = useCallback(async () => {
    const result = await note.flushSave();
    if (result === "saved") onShowNotice("Research note saved");
    else if (result === "skipped") onShowNotice("Research note is already saved");
    else onShowNotice("Research note save failed — see the save status in the notes pane");
  }, [note.flushSave, onShowNotice]);

  useEffect(() => {
    if (!intent || handledIntentIdsRef.current.has(intent.id)) return;
    handledIntentIdsRef.current.add(intent.id);
    onConsumeIntent?.(intent.id);

    if (intent.type === "save-active") {
      void handleSaveNote();
      return;
    }

    setReaderMode(intent.mode);
  }, [intent, onConsumeIntent, handleSaveNote, setReaderMode]);

  const handleImport = async () => {
    try {
      const result = await attApi.pickAndImportAttachment();
      if (result) {
        onShowNotice(`Imported "${result.attachment.file_name}"`);
        await loadDocuments();
        setActiveAttachment(result.attachment);
        // Never clobber a session for an already-imported document.
        ensureReaderSession(result.attachment.id);
        setIsDocPickerOpen(false);
      }
    } catch (err: any) {
      console.error("Import error:", err);
      onShowNotice(`Import failed: ${err?.message || err}`);
    }
  };

  const handlePickDocument = (document: AttachmentSummary) => {
    // The hydration effect restores this document's own page/zoom/scroll
    // session. Writing page 1 here would destroy it before it can be read.
    setActiveAttachment(document);
  };

  const revealWriting = useCallback(() => {
    setDrawerTab("highlights");
    if (layout.mode === "reading") {
      layout.setMode(layout.isNarrow ? "writing" : "research");
    }
  }, [layout.isNarrow, layout.mode, layout.setMode]);

  const handleHighlightCreated = useCallback((highlight: Highlight) => {
    setHighlights((current) =>
      current.some((item) => item.id === highlight.id) ? current : [...current, highlight]
    );
  }, []);

  const handleExcerptAdded = useCallback(
    async (highlight: Highlight) => {
      if (!activeAttachment) return;
      try {
        const result = await note.insertExcerpt(highlight, activeAttachment.file_name);
        if (result === "inserted") revealWriting();
        onShowNotice(result === "inserted" ? "Passage added to notes" : "Passage is already in notes");
      } catch (err: any) {
        console.error("Failed to add excerpt to notes:", err);
        onShowNotice(`Could not add passage to notes: ${err?.message || err}`);
      }
    },
    [activeAttachment, note.insertExcerpt, onShowNotice, revealWriting]
  );

  const activeAttachmentId = activeAttachment?.id;
  const handleDocumentScrollTop = useCallback(
    (top: number) => {
      if (activeAttachmentId) saveReaderSession(activeAttachmentId, { scrollTop: top });
    },
    [activeAttachmentId]
  );
  const handleWritingScrollTop = useCallback(
    (top: number) => {
      if (activeAttachmentId) saveReaderSession(activeAttachmentId, { writingScrollTop: top });
    },
    [activeAttachmentId]
  );
  const handleHighlightDeleted = useCallback((id: string) => {
    setHighlights((current) => current.filter((item) => item.id !== id));
    note.removeExcerpt(id);
    setSelectedHighlightId((current) => (current === id ? null : current));
  }, [note.removeExcerpt]);
  const handleHighlightUpdated = useCallback((updated: Highlight) => {
    setHighlights((current) =>
      current.map((item) => (item.id === updated.id ? updated : item))
    );
  }, []);

  const handleResetLayout = () => {
    // The layout hook batches these into one settings write.
    layout.setRatio(DEFAULT_SPLIT_RATIO);
    layout.setMode("research");
    setZoom(1);
    setFitWidth(true);
  };

  const handleViewerHighlightSelected = useCallback(
    (id: string) => {
      setSelectedHighlightId(id);
      setAnnotationRequestId(null);
      revealWriting();
    },
    [revealWriting]
  );

  const handleAnnotationRequested = useCallback(
    (id: string) => {
      setSelectedHighlightId(id);
      setAnnotationRequestId(id);
      setDrawerTab("highlights");
      revealWriting();
    },
    [revealWriting]
  );

  const handleJumpToPage = useCallback(
    (page: number, attachmentId?: string) => {
      const target = attachmentId || activeAttachment?.id;
      if (!target) return;
      if (attachmentId && attachmentId !== activeAttachment?.id) {
        saveReaderSession(attachmentId, { currentPage: page });
        setActiveAttachment(documents.find((doc) => doc.id === attachmentId) || activeAttachment);
      }
      setCurrentPage(Math.max(1, page));
      if (layout.mode === "writing") layout.setMode("research");
      else if (layout.isNarrow && layout.mode === "research") layout.setMode("reading");
    },
    [activeAttachment, documents, layout.isNarrow, layout.mode, layout.setMode]
  );

  const handleTotalPagesDetected = useCallback((total: number) => {
    setTotalPages(total);
    setCurrentPage((page) => Math.min(Math.max(1, page), Math.max(1, total)));
  }, []);

  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(Math.min(totalPages, Math.max(1, page)));
    },
    [totalPages]
  );

  const handleZoomChange = useCallback((next: number) => {
    setZoom(Math.min(2.5, Math.max(0.6, +next.toFixed(2))));
  }, []);

  const showDocument = layout.mode !== "writing";
  // Narrow layouts still need a writing workspace: research shows the
  // document with a switch, writing shows the notes full width.
  const showWriting = layout.mode === "writing" || (layout.mode === "research" && !layout.isNarrow);
  const showDivider = Boolean(activeAttachment) && layout.mode === "research" && !layout.isNarrow;
  const gridColumns =
    showDivider
      ? `minmax(0, ${layout.ratio}fr) 10px minmax(0, ${1 - layout.ratio}fr)`
      : "minmax(0, 1fr)";

  return (
    <div className="research-reader-container">
      <div
        ref={layout.containerRef}
        className={`reader-shell mode-${layout.mode} ${layout.isNarrow ? "is-narrow" : ""} ${
          isFocusSpace ? "is-focus" : ""
        }`}
        data-reader-mode={layout.mode}
      >
        <div className={isFocusSpace ? "reader-toolbar-focus-wrap" : "reader-toolbar-wrap"}>
          <ReaderToolbar
            documents={documents}
            activeAttachment={activeAttachment}
            isDocPickerOpen={isDocPickerOpen}
            docPickerRef={docPickerRef}
            docPickerTriggerRef={docPickerTriggerRef}
            onDocPickerToggle={() => setIsDocPickerOpen((current) => !current)}
            onPickDocument={handlePickDocument}
            onImport={handleImport}
            mode={layout.mode}
            onModeChange={layout.setMode}
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
            zoom={zoom}
            onZoomChange={(next) => {
              handleZoomChange(next);
              setFitWidth(false);
            }}
            annotationType={annotationType}
            onAnnotationTypeChange={setAnnotationType}
            isFocusSpace={isFocusSpace}
            onToggleFocus={handleToggleFocus}
            showRestoreNavigation={layout.chrome.navigation !== "full"}
            onRestoreNavigation={layout.restoreNavigation}
            onResetLayout={handleResetLayout}
            onSaveNote={() => void handleSaveNote()}
            isNarrow={layout.isNarrow}
          />
        </div>

        <div className="reader-adaptive-body" style={{ gridTemplateColumns: gridColumns }}>
          <div
            key="reader-document-pane"
            className="reader-document-pane"
            style={{ display: showDocument ? undefined : "none" }}
          >
            {isLoading ? (
              <div className="reader-surface-state">Loading document…</div>
            ) : loadError ? (
              <div className="reader-surface-state error">
                <strong>Could not load document:</strong>
                <p>{loadError}</p>
              </div>
            ) : !activeAttachment ? (
              <div className="reader-surface-state">
                <h2>No Research Documents in Library</h2>
                <p>Import a PDF, Markdown paper, or text document to begin reading and annotating.</p>
                <button className="reader-primary-btn" onClick={handleImport}>
                  Import Research Document
                </button>
              </div>
            ) : viewerType === "markdown" || viewerType === "text" ? (
              <MarkdownReader
                key={activeAttachment.id}
                content={textContent || ""}
                attachmentId={activeAttachment.id}
                documentTitle={activeAttachment.file_name}
                highlights={highlights}
                onHighlightCreated={handleHighlightCreated}
                onHighlightSelected={handleViewerHighlightSelected}
                onAnnotationRequested={handleAnnotationRequested}
                onRecordCreatedFromExcerpt={(recordId) => onNavigateToRecord?.(recordId)}
                onExcerptAdded={handleExcerptAdded}
                onShowNotice={onShowNotice}
                zoom={zoom}
                annotationType={annotationType}
              />
            ) : viewerType === "pdf" && dataUrl ? (
              <PdfViewer
                key={activeAttachment.id}
                dataUrl={dataUrl}
                attachmentId={activeAttachment.id}
                documentTitle={activeAttachment.file_name}
                highlights={highlights}
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
                onTotalPagesDetected={handleTotalPagesDetected}
                onOutlineLoaded={setOutline}
                onHighlightCreated={handleHighlightCreated}
                onHighlightSelected={handleViewerHighlightSelected}
                onAnnotationRequested={handleAnnotationRequested}
                onRecordCreatedFromExcerpt={(recordId) => onNavigateToRecord?.(recordId)}
                onExcerptAdded={handleExcerptAdded}
                onShowNotice={onShowNotice}
                zoom={zoom}
                onZoomChange={handleZoomChange}
                fitWidth={fitWidth}
                onFitWidthChange={setFitWidth}
                annotationType={annotationType}
                selectedHighlightId={selectedHighlightId}
                initialScrollTop={initialScrollTopRef.current}
                onScrollTopChange={handleDocumentScrollTop}
              />
            ) : (
              <div className="reader-surface-state">
                This attachment cannot be displayed in the Research Reader.
              </div>
            )}
          </div>

          <div
            key="reader-divider-slot"
            style={{ display: showDivider ? undefined : "none", height: showDivider ? "100%" : undefined }}
          >
            <ReaderDivider
              ratio={layout.ratio}
              containerRef={layout.containerRef}
              onRatioChange={layout.setRatio}
            />
          </div>

          {activeAttachment && (
            <div
              key="reader-writing-pane"
              className="reader-writing-pane"
              style={{ display: showWriting ? undefined : "none" }}
            >
              {layout.mode === "writing" && (
                <div className="reader-writing-source">
                  <span className="reader-section-label">Source</span>
                  <button onClick={() => layout.setMode("research")}>
                    <span>{activeAttachment.file_name}</span>
                    <span>p. {currentPage}</span>
                  </button>
                </div>
              )}
              <ReaderDrawer
                isOpen
                onClose={() => layout.setMode("reading")}
                activeTab={drawerTab}
                onTabChange={setDrawerTab}
                highlights={highlights}
                outline={effectiveOutline}
                attachment={activeAttachment}
                selectedHighlightId={selectedHighlightId}
                onSelectHighlight={setSelectedHighlightId}
                onJumpToPage={handleJumpToPage}
                onOpenConnectModal={setConnectHighlight}
                onHighlightDeleted={handleHighlightDeleted}
                onHighlightUpdated={handleHighlightUpdated}
                onNavigateToRecord={onNavigateToRecord}
                onShowNotice={onShowNotice}
                hasNote={note.hasNote}
                noteTitle={note.title}
                noteContent={note.content}
                noteTags={visibleNoteTags(note.tags)}
                noteSaveStatus={note.saveStatus}
                noteError={note.error}
                noteExcerpts={noteExcerpts}
                noteContentRef={note.contentRef}
                annotationRequestId={annotationRequestId}
                initialScrollTop={initialWritingScrollTopRef.current}
                onScrollTopChange={handleWritingScrollTop}
                onStartNote={() => void note.startNote()}
                onNoteTitleChange={note.setTitle}
                onNoteContentChange={note.setContent}
                onNoteTagsChange={note.setTags}
                onSaveNote={() => void handleSaveNote()}
                onInsertMarkdown={note.insertMarkdown}
              />
            </div>
          )}

          {layout.isNarrow && layout.mode === "research" && activeAttachment && (
            <button className="reader-narrow-switch" onClick={() => layout.setMode("writing")}>
              Open writing workspace
            </button>
          )}
        </div>

        {connectHighlight && activeAttachment && (
          <ConnectExcerptModal
            highlight={connectHighlight}
            documentTitle={activeAttachment.file_name}
            onClose={() => setConnectHighlight(null)}
            onRecordCreated={(recordId) => onNavigateToRecord?.(recordId)}
            onShowNotice={onShowNotice}
          />
        )}
      </div>
    </div>
  );
};
