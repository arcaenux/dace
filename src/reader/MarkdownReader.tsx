import {
  FC,
  useRef,
  useState,
  useCallback,
} from "react";
import { Highlight, HighlightType } from "./types.ts";
import { FloatingSelectionToolbar } from "./FloatingSelectionToolbar.tsx";
import { ConnectExcerptModal } from "./ConnectExcerptModal.tsx";
import * as readerApi from "./readerApi.ts";

interface MarkdownReaderProps {
  content: string;
  attachmentId: string;
  documentTitle: string;
  highlights: Highlight[];
  onHighlightCreated: (highlight: Highlight) => void;
  onHighlightSelected?: (highlightId: string) => void;
  onRecordCreatedFromExcerpt?: (recordId: string) => void;
  onShowNotice: (msg: string) => void;
  isDistractionFree?: boolean;
}

export const MarkdownReader: FC<MarkdownReaderProps> = ({
  content,
  attachmentId,
  documentTitle,
  highlights,
  onHighlightCreated,
  onHighlightSelected,
  onRecordCreatedFromExcerpt,
  onShowNotice,
  isDistractionFree = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);

  const [selectionRange, setSelectionRange] = useState<{
    text: string;
    toolbarPos: { top: number; left: number };
  } | null>(null);

  const [connectHighlight, setConnectHighlight] = useState<Highlight | null>(null);

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setSelectionRange(null);
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
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

  const handleCreateHighlight = async (type: HighlightType, initialNote?: string) => {
    if (!selectionRange) return;

    const anchorData = JSON.stringify({
      pageNumber: 1,
      textLength: selectionRange.text.length,
    });

    try {
      const newHl = await readerApi.createHighlight({
        attachment_id: attachmentId,
        page_number: 1,
        selected_text: selectionRange.text,
        anchor_data: anchorData,
        highlight_type: type,
        annotation_content: initialNote || null,
      });

      onHighlightCreated(newHl);
      onShowNotice(`Highlighted passage as "${type}"`);
      setSelectionRange(null);
      window.getSelection()?.removeAllRanges();

      if (initialNote) {
        onHighlightSelected?.(newHl.id);
      }
    } catch (err: any) {
      console.error("Failed to create highlight:", err);
      onShowNotice(`Failed to create highlight: ${err?.message || err}`);
    }
  };

  const handleConnectSelection = async () => {
    if (!selectionRange) return;

    const anchorData = JSON.stringify({
      pageNumber: 1,
      textLength: selectionRange.text.length,
    });

    try {
      const newHl = await readerApi.createHighlight({
        attachment_id: attachmentId,
        page_number: 1,
        selected_text: selectionRange.text,
        anchor_data: anchorData,
        highlight_type: "important",
      });

      onHighlightCreated(newHl);
      setSelectionRange(null);
      window.getSelection()?.removeAllRanges();
      setConnectHighlight(newHl);
    } catch (e: any) {
      onShowNotice(`Could not prepare highlight for connection: ${e?.message || e}`);
    }
  };

  return (
    <div
      className={`reader-viewport ${isDistractionFree ? "distraction-free" : ""}`}
      ref={containerRef}
      onMouseUp={handleMouseUp}
    >
      <article
        ref={articleRef}
        className="markdown-reader-content"
        style={{ position: "relative" }}
      >
        {highlights.length > 0 && (
          <div style={{ marginBottom: "20px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {highlights.map((hl) => (
              <span
                key={hl.id}
                className={`toolbar-hl-btn type-${hl.highlight_type}`}
                style={{
                  fontSize: "0.74rem",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  border: "1px solid var(--border-subtle)",
                  cursor: "pointer",
                }}
                onClick={() => onHighlightSelected?.(hl.id)}
                title={`Jump to note: "${hl.selected_text}"`}
              >
                <span className={`hl-dot ${hl.highlight_type}`} />
                <span>{hl.selected_text.slice(0, 24)}...</span>
              </span>
            ))}
          </div>
        )}

        <div style={{ whiteSpace: "pre-wrap" }}>{content}</div>

        {selectionRange && (
          <FloatingSelectionToolbar
            position={selectionRange.toolbarPos}
            onHighlight={(type) => handleCreateHighlight(type)}
            onAddNote={() => handleCreateHighlight("insight", "Personal note...")}
            onConnectExcerpt={handleConnectSelection}
            onClose={() => setSelectionRange(null)}
          />
        )}
      </article>

      {connectHighlight && (
        <ConnectExcerptModal
          highlight={connectHighlight}
          documentTitle={documentTitle}
          onClose={() => setConnectHighlight(null)}
          onRecordCreated={(recId) => onRecordCreatedFromExcerpt?.(recId)}
          onShowNotice={onShowNotice}
        />
      )}
    </div>
  );
};
