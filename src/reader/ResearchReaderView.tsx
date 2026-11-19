import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type ReaderDrawerTab = "highlights" | "outline" | "knowledge" | "info";

interface ResearchReaderViewProps {
  initialAttachmentId?: string | null;
  initialPage?: number | null;
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

  const [drawerTab, setDrawerTab] = useState<ReaderDrawerTab>("highlights");
  const [connectHighlight, setConnectHighlight] = useState<Highlight | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [fitWidth, setFitWidth] = useState<boolean>(true);
  const [annotationType, setAnnotationType] = useState<Highlight["highlight_type"] | null>(null);

  const layout = useAdaptiveReaderLayout(onChromeChange);
  const note = useReaderNote(activeAttachment);
  const noteExcerpts = useMemo(() => parseNoteExcerpts(note.content), [note.content]);

  const viewerType = activeAttachment
    ? getViewerType(activeAttachment.mime_type, activeAttachment.file_name)
    : "pdf";
  const effectiveOutline = viewerType === "pdf" ? outline : outlineFromText(textContent || "");

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
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (!activeAttachment) return;
    let isMounted = true;
    setIsLoading(true);
    setLoadError(null);
    setDataUrl(null);
    setTextContent(null);
    setSelectedHighlightId(null);
    setOutline([]);

    async function loadContent() {
      try {
        const type = getViewerType(activeAttachment!.mime_type, activeAttachment!.file_name);
        if (type === "markdown" || type === "text") {
          const text = await attApi.readAttachmentText(activeAttachment!.id);
          if (isMounted) setTextContent(text);
        } else {
          const url = await attApi.readAttachmentDataUrl(activeAttachment!.id);
          if (isMounted) setDataUrl(url);
        }
        const savedHighlights = await readerApi.getAttachmentHighlights(activeAttachment!.id);
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
  }, [activeAttachment]);

  useEffect(() => {
    const onSaveEvent = () => {
      void note.flushSave().then(() => onShowNotice("Research note saved"));
    };
    window.addEventListener("dace:save-reader-note", onSaveEvent);
    return () => window.removeEventListener("dace:save-reader-note", onSaveEvent);
  }, [note.flushSave, onShowNotice]);

  const handleImport = async () => {
    try {
      const result = await attApi.pickAndImportAttachment();
      if (result) {
        onShowNotice(`Imported "${result.attachment.file_name}"`);
        await loadDocuments();
        setActiveAttachment(result.attachment);
        setCurrentPage(1);
        setIsDocPickerOpen(false);
      }
    } catch (err: any) {
      console.error("Import error:", err);
      onShowNotice(`Import failed: ${err?.message || err}`);
    }
  };

  const handlePickDocument = (document: AttachmentSummary) => {
    setActiveAttachment(document);
    setCurrentPage(1);
    setTotalPages(1);
  };

  const revealWriting = () => {
    setDrawerTab("highlights");
    if (layout.mode === "reading") {
      layout.setMode(layout.isNarrow ? "writing" : "research");
    }
  };

  const handleHighlightCreated = (highlight: Highlight) => {
    setHighlights((current) => [...current, highlight]);
  };

  const handleExcerptAdded = async (highlight: Highlight) => {
    if (!activeAttachment) return;
    const result = await note.insertExcerpt(highlight, activeAttachment.file_name);
    revealWriting();
    onShowNotice(result === "inserted" ? "Passage added to notes" : "Passage is already in notes");
  };

  const handleResetLayout = () => {
    layout.setRatio(DEFAULT_SPLIT_RATIO);
    layout.setMode("research");
    setZoom(1);
    setFitWidth(true);
  };

  const handleSaveNote = () => {
    void note.flushSave().then(() => onShowNotice("Research note saved"));
  };

  const handleToggleFocus = () => {
    onToggleFocus?.();
  };

  const showDocument = layout.mode !== "writing";
  const showWriting = layout.mode !== "reading" && !layout.isNarrow;
  const gridColumns =
    layout.mode === "research" && !layout.isNarrow
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
            onPageChange={setCurrentPage}
            zoom={zoom}
            onZoomChange={(next) => {
              setZoom(next);
              setFitWidth(false);
            }}
            annotationType={annotationType}
            onAnnotationTypeChange={setAnnotationType}
            isFocusSpace={isFocusSpace}
            onToggleFocus={handleToggleFocus}
            showRestoreNavigation={layout.chrome.navigation !== "full"}
            onRestoreNavigation={layout.restoreNavigation}
            onResetLayout={handleResetLayout}
            onSaveNote={handleSaveNote}
            isNarrow={layout.isNarrow}
          />
        </div>

        <div className="reader-adaptive-body" style={{ gridTemplateColumns: gridColumns }}>
          {showDocument && (
            <div className="reader-document-pane">
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
                  content={textContent || ""}
                  attachmentId={activeAttachment.id}
                  documentTitle={activeAttachment.file_name}
                  highlights={highlights}
                  onHighlightCreated={handleHighlightCreated}
                  onHighlightSelected={(id) => {
                    setSelectedHighlightId(id);
                    revealWriting();
                  }}
                  onRecordCreatedFromExcerpt={(recordId) => onNavigateToRecord?.(recordId)}
                  onExcerptAdded={handleExcerptAdded}
                  onShowNotice={onShowNotice}
                  zoom={zoom}
                  annotationType={annotationType}
                />
              ) : (
                <PdfViewer
                  dataUrl={dataUrl || ""}
                  attachmentId={activeAttachment.id}
                  documentTitle={activeAttachment.file_name}
                  highlights={highlights}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                  onTotalPagesDetected={setTotalPages}
                  onOutlineLoaded={setOutline}
                  onHighlightCreated={handleHighlightCreated}
                  onHighlightSelected={(id) => {
                    setSelectedHighlightId(id);
                    revealWriting();
                  }}
                  onRecordCreatedFromExcerpt={(recordId) => onNavigateToRecord?.(recordId)}
                  onExcerptAdded={handleExcerptAdded}
                  onShowNotice={onShowNotice}
                  zoom={zoom}
                  onZoomChange={setZoom}
                  fitWidth={fitWidth}
                  onFitWidthChange={setFitWidth}
                  annotationType={annotationType}
                />
              )}
            </div>
          )}

          {layout.mode === "research" && !layout.isNarrow && (
            <ReaderDivider
              ratio={layout.ratio}
              containerRef={layout.containerRef}
              onRatioChange={layout.setRatio}
            />
          )}

          {showWriting && activeAttachment && (
            <div className="reader-writing-pane">
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
                onJumpToPage={(page) => {
                  setCurrentPage(page);
                  if (layout.isNarrow) layout.setMode("reading");
                }}
                onOpenConnectModal={setConnectHighlight}
                onHighlightDeleted={(id) => setHighlights((current) => current.filter((h) => h.id !== id))}
                onHighlightUpdated={(updated) =>
                  setHighlights((current) => current.map((h) => (h.id === updated.id ? updated : h)))
                }
                onNavigateToRecord={onNavigateToRecord}
                onShowNotice={onShowNotice}
                hasNote={note.hasNote}
                noteTitle={note.title}
                noteContent={note.content}
                noteTags={note.tags}
                noteSaveStatus={note.saveStatus}
                noteError={note.error}
                noteExcerpts={noteExcerpts}
                noteContentRef={note.contentRef}
                onStartNote={() => void note.startNote()}
                onNoteTitleChange={note.setTitle}
                onNoteContentChange={note.setContent}
                onNoteTagsChange={note.setTags}
                onSaveNote={handleSaveNote}
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
