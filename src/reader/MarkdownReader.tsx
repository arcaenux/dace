import {
  FC,
  memo,
  useCallback,
  useRef,
  useState,
} from "react";
import { Highlight, HighlightType } from "./types.ts";
import { FloatingSelectionToolbar } from "./FloatingSelectionToolbar.tsx";
import { ConnectExcerptModal } from "./ConnectExcerptModal.tsx";
import * as readerApi from "./readerApi.ts";
import { createAnchorData, findExistingHighlight } from "./readerSelection.ts";

interface MarkdownReaderProps {
  content: string;
  attachmentId: string;
  documentTitle: string;
  highlights: Highlight[];
  onHighlightCreated: (highlight: Highlight) => void;
  onHighlightSelected?: (highlightId: string) => void;
  onAnnotationRequested?: (highlightId: string) => void;
  onRecordCreatedFromExcerpt?: (recordId: string) => void;
  onExcerptAdded?: (highlight: Highlight) => Promise<void>;
  onShowNotice: (msg: string) => void;
  isDistractionFree?: boolean;
  zoom: number;
  annotationType?: HighlightType | null;
  onSpeedRead?: (text: string) => void;
}

interface SelectionCapture {
  text: string;
  toolbarPos: { top: number; left: number };
}

const MarkdownReaderComponent: FC<MarkdownReaderProps> = ({
  content,
  attachmentId,
  documentTitle,
  highlights,
  onHighlightCreated,
  onHighlightSelected,
  onAnnotationRequested,
  onRecordCreatedFromExcerpt,
  onExcerptAdded,
  onShowNotice,
  isDistractionFree = false,
  zoom,
  annotationType = null,
  onSpeedRead,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;

  const callbacksRef = useRef({
    onHighlightCreated,
    onHighlightSelected,
    onAnnotationRequested,
    onRecordCreatedFromExcerpt,
    onExcerptAdded,
    onShowNotice,
    onSpeedRead,
  });
  callbacksRef.current = {
    onHighlightCreated,
    onHighlightSelected,
    onAnnotationRequested,
    onRecordCreatedFromExcerpt,
    onExcerptAdded,
    onShowNotice,
    onSpeedRead,
  };

  const [selectionRange, setSelectionRange] = useState<SelectionCapture | null>(null);
  const [connectHighlight, setConnectHighlight] = useState<Highlight | null>(null);

  const clearSelection = useCallback(() => {
    setSelectionRange(null);
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) selection.removeAllRanges();
  }, []);

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setSelectionRange(null);
      return;
    }

    const text = selection.toString();
    if (!text.trim()) {
      setSelectionRange(null);
      return;
    }

    const article = articleRef.current;
    if (!article) return;
    const range = selection.getRangeAt(0);
    if (!article.contains(range.commonAncestorContainer)) {
      setSelectionRange(null);
      return;
    }

    const articleRect = article.getBoundingClientRect();
    const rangeRect = range.getBoundingClientRect();
    setSelectionRange({
      text,
      toolbarPos: {
        top: rangeRect.top - articleRect.top,
        left: rangeRect.left - articleRect.left + rangeRect.width / 2 - 120,
      },
    });
  }, []);

  const ensureHighlight = useCallback(
    async (type: HighlightType, annotationContent?: string | null) => {
      const selection = selectionRange;
      if (!selection) return null;
      const identity = { attachmentId, page: 1, text: selection.text };
      const existing = findExistingHighlight(highlightsRef.current, identity);
      if (existing) return existing;

      const highlight = await readerApi.createHighlight({
        attachment_id: attachmentId,
        page_number: 1,
        selected_text: selection.text,
        anchor_data: createAnchorData({
          rects: [],
          pageNumber: 1,
          text: selection.text,
        }),
        highlight_type: type,
        annotation_content: annotationContent || null,
      });
      callbacksRef.current.onHighlightCreated(highlight);
      return highlight;
    },
    [attachmentId, selectionRange]
  );

  const withSelectionAction = useCallback(
    async (action: (selection: SelectionCapture) => Promise<void>) => {
      const selection = selectionRange;
      if (!selection) return;
      try {
        await action(selection);
        clearSelection();
      } catch (err: any) {
        console.error("Reader selection action failed:", err);
        callbacksRef.current.onShowNotice(`Selection action failed: ${err?.message || err}`);
      }
    },
    [clearSelection, selectionRange]
  );

  const handleCreateHighlight = useCallback(
    (type: HighlightType) => {
      void withSelectionAction(async () => {
        const highlight = await ensureHighlight(type);
        if (!highlight) return;
        callbacksRef.current.onShowNotice(`Highlighted passage as "${type}"`);
      });
    },
    [ensureHighlight, withSelectionAction]
  );

  const handleAddNote = useCallback(() => {
    void withSelectionAction(async () => {
      const highlight = await ensureHighlight(annotationType || "insight");
      if (highlight) callbacksRef.current.onAnnotationRequested?.(highlight.id);
    });
  }, [annotationType, ensureHighlight, withSelectionAction]);

  const handleAddToNotes = useCallback(() => {
    void withSelectionAction(async () => {
      const highlight = await ensureHighlight(annotationType || "insight");
      if (!highlight || !callbacksRef.current.onExcerptAdded) return;
      await callbacksRef.current.onExcerptAdded(highlight);
    });
  }, [annotationType, ensureHighlight, withSelectionAction]);

  const handleCreateExcerpt = useCallback(() => {
    void withSelectionAction(async () => {
      const identity = { attachmentId, page: 1, text: selectionRange?.text || "" };
      if (findExistingHighlight(highlightsRef.current, identity)) {
        callbacksRef.current.onShowNotice("Excerpt already captured");
        return;
      }
      const highlight = await ensureHighlight(annotationType || "important");
      if (highlight) callbacksRef.current.onShowNotice("Excerpt captured from this passage");
    });
  }, [annotationType, attachmentId, ensureHighlight, selectionRange, withSelectionAction]);

  const handleConnect = useCallback(() => {
    void withSelectionAction(async () => {
      const highlight = await ensureHighlight("important");
      if (highlight) setConnectHighlight(highlight);
    });
  }, [ensureHighlight, withSelectionAction]);

  return (
    <div
      className={`reader-viewport ${isDistractionFree ? "distraction-free" : ""}`}
      ref={containerRef}
      onMouseUp={handleMouseUp}
    >
      <article
        ref={articleRef}
        className="markdown-reader-content"
        style={{
          position: "relative",
          fontSize: `${Math.round(15 * zoom)}px`,
          maxWidth: `${Math.round(760 / Math.max(0.8, zoom))}px`,
        }}
      >
        {highlights.length > 0 && (
          <div style={{ marginBottom: "20px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {highlights.map((highlight) => (
              <button
                key={highlight.id}
                className={`toolbar-hl-btn type-${highlight.highlight_type}`}
                style={{
                  fontSize: "0.74rem",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  border: "1px solid var(--border-subtle)",
                  cursor: "pointer",
                }}
                onClick={() => callbacksRef.current.onHighlightSelected?.(highlight.id)}
                title={`Jump to note: "${highlight.selected_text}"`}
              >
                <span className={`hl-dot ${highlight.highlight_type}`} />
                <span>{highlight.selected_text.slice(0, 24)}...</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ whiteSpace: "pre-wrap" }}>{content}</div>

        {selectionRange && (
          <FloatingSelectionToolbar
            position={selectionRange.toolbarPos}
            onHighlight={handleCreateHighlight}
            onAddNote={handleAddNote}
            onAddToNotes={handleAddToNotes}
            onExcerpt={handleCreateExcerpt}
            onConnectExcerpt={handleConnect}
            onSpeedRead={() => callbacksRef.current.onSpeedRead?.(selectionRange.text)}
            onClose={clearSelection}
            preferredType={annotationType}
          />
        )}
      </article>

      {connectHighlight && (
        <ConnectExcerptModal
          highlight={connectHighlight}
          documentTitle={documentTitle}
          onClose={() => setConnectHighlight(null)}
          onRecordCreated={(recordId) => callbacksRef.current.onRecordCreatedFromExcerpt?.(recordId)}
          onShowNotice={onShowNotice}
        />
      )}
    </div>
  );
};

export const MarkdownReader = memo(MarkdownReaderComponent);
