import {
  FC,
  useRef,
  useState,
  useEffect,
  useCallback,
  MouseEvent as ReactMouseEvent,
} from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { Highlight, HighlightType, OutlineItem } from "./types.ts";
import { FloatingSelectionToolbar } from "./FloatingSelectionToolbar.tsx";
import { ConnectExcerptModal } from "./ConnectExcerptModal.tsx";
import * as readerApi from "./readerApi.ts";

// Configure workerSrc
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface PdfViewerProps {
  dataUrl: string;
  attachmentId: string;
  documentTitle: string;
  highlights: Highlight[];
  currentPage: number;
  onPageChange: (page: number) => void;
  onTotalPagesDetected: (total: number) => void;
  onOutlineLoaded?: (outline: OutlineItem[]) => void;
  onHighlightCreated: (highlight: Highlight) => void;
  onHighlightSelected?: (highlightId: string) => void;
  onRecordCreatedFromExcerpt?: (recordId: string) => void;
  onShowNotice: (msg: string) => void;
  isDistractionFree?: boolean;
}

export const PdfViewer: FC<PdfViewerProps> = ({
  dataUrl,
  attachmentId,
  documentTitle,
  highlights,
  currentPage,
  onPageChange,
  onTotalPagesDetected,
  onOutlineLoaded,
  onHighlightCreated,
  onHighlightSelected,
  onRecordCreatedFromExcerpt,
  onShowNotice,
  isDistractionFree = false,
}) => {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.25);
  const [isScanned, setIsScanned] = useState<boolean>(false);
  const [selectedHighlightId, setSelectedHighlightId] = useState<string | null>(null);

  // Floating selection state
  const [selectionRange, setSelectionRange] = useState<{
    text: string;
    rects: { left: number; top: number; width: number; height: number }[];
    toolbarPos: { top: number; left: number };
  } | null>(null);

  // Connect modal state
  const [connectHighlight, setConnectHighlight] = useState<Highlight | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<any>(null);

  // 1. Load PDF Document from Data URL or binary buffer
  useEffect(() => {
    let isMounted = true;

    async function loadPdf() {
      try {
        const loadingTask = pdfjsLib.getDocument(dataUrl);
        const doc = await loadingTask.promise;
        if (!isMounted) return;

        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        onTotalPagesDetected(doc.numPages);

        // Extract PDF Outline / Bookmarks if available
        try {
          const rawOutline = await doc.getOutline();
          if (rawOutline && onOutlineLoaded) {
            const parsedOutline = formatOutline(rawOutline);
            onOutlineLoaded(parsedOutline);
          }
        } catch (e) {
          console.warn("Could not extract PDF outline:", e);
        }
      } catch (err: any) {
        console.error("Error loading PDF document:", err);
        onShowNotice(`Failed to render PDF: ${err?.message || err}`);
      }
    }

    loadPdf();

    return () => {
      isMounted = false;
    };
  }, [dataUrl, onTotalPagesDetected, onOutlineLoaded, onShowNotice]);

  function formatOutline(items: any[]): OutlineItem[] {
    return items.map((item) => ({
      title: item.title,
      dest: item.dest,
      items: item.items && item.items.length > 0 ? formatOutline(item.items) : undefined,
    }));
  }

  // 2. Render Page Canvas & TextLayer when currentPage, scale, or doc changes
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;

    async function renderPage() {
      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
        }

        const page = await pdfDoc!.getPage(currentPage);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext("2d");
        if (!context) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        if (pageContainerRef.current) {
          pageContainerRef.current.style.width = `${Math.floor(viewport.width)}px`;
          pageContainerRef.current.style.height = `${Math.floor(viewport.height)}px`;
        }

        const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;

        const renderContext = {
          canvasContext: context,
          viewport,
          transform,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;
        await renderTask.promise;

        if (cancelled) return;

        // Render TextLayer
        const textLayerDiv = textLayerRef.current;
        if (textLayerDiv) {
          textLayerDiv.innerHTML = "";
          textLayerDiv.style.width = `${Math.floor(viewport.width)}px`;
          textLayerDiv.style.height = `${Math.floor(viewport.height)}px`;
          textLayerDiv.style.setProperty("--scale-factor", `${scale}`);

          const textContent = await page.getTextContent();
          if (cancelled) return;

          if (textContent.items.length === 0) {
            setIsScanned(true);
          } else {
            setIsScanned(false);
            const textLayer = new pdfjsLib.TextLayer({
              textContentSource: textContent,
              container: textLayerDiv,
              viewport,
            });
            await textLayer.render();
          }
        }
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException") {
          console.error("Error rendering PDF page:", err);
        }
      }
    }

    renderPage();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [pdfDoc, currentPage, scale]);

  // 3. Text Selection Detection for Highlights
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setSelectionRange(null);
      return;
    }

    const text = selection.toString().trim();
    if (!text || text.length === 0) {
      setSelectionRange(null);
      return;
    }

    const pageContainer = pageContainerRef.current;
    if (!pageContainer) return;

    // Check if selection is within the pageContainer
    const range = selection.getRangeAt(0);
    if (!pageContainer.contains(range.commonAncestorContainer)) {
      setSelectionRange(null);
      return;
    }

    const pageRect = pageContainer.getBoundingClientRect();
    const rangeRect = range.getBoundingClientRect();

    // Calculate normalized rects relative to the page container
    const clientRects = range.getClientRects();
    const rects: { left: number; top: number; width: number; height: number }[] = [];
    for (let i = 0; i < clientRects.length; i++) {
      const cr = clientRects[i];
      rects.push({
        left: (cr.left - pageRect.left) / scale,
        top: (cr.top - pageRect.top) / scale,
        width: cr.width / scale,
        height: cr.height / scale,
      });
    }

    // Position floating toolbar relative to pageContainer
    const toolbarPos = {
      top: rangeRect.top - pageRect.top,
      left: rangeRect.left - pageRect.left + rangeRect.width / 2 - 120,
    };

    setSelectionRange({
      text,
      rects,
      toolbarPos,
    });
  }, [scale]);

  // 4. Create Highlight Handler
  const handleCreateHighlight = async (type: HighlightType, initialNote?: string) => {
    if (!selectionRange) return;

    const anchorData = JSON.stringify({
      rects: selectionRange.rects,
      pageNumber: currentPage,
      textLength: selectionRange.text.length,
    });

    try {
      const newHl = await readerApi.createHighlight({
        attachment_id: attachmentId,
        page_number: currentPage,
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

  const handleAddNoteToSelection = () => {
    handleCreateHighlight("insight", "Personal note...");
  };

  const handleConnectSelection = async () => {
    if (!selectionRange) return;

    const anchorData = JSON.stringify({
      rects: selectionRange.rects,
      pageNumber: currentPage,
      textLength: selectionRange.text.length,
    });

    try {
      const newHl = await readerApi.createHighlight({
        attachment_id: attachmentId,
        page_number: currentPage,
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

  // Keyboard Navigation: Left/Right arrow keys for page turning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;
      if (isInput) return;

      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        if (currentPage > 1) {
          e.preventDefault();
          onPageChange(currentPage - 1);
        }
      } else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        if (currentPage < totalPages) {
          e.preventDefault();
          onPageChange(currentPage + 1);
        }
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setScale((s) => Math.min(2.5, +(s + 0.15).toFixed(2)));
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setScale((s) => Math.max(0.6, +(s - 0.15).toFixed(2)));
      } else if (e.key === "0") {
        e.preventDefault();
        setScale(1.25);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentPage, totalPages, onPageChange, setScale]);

  // Current page highlights
  const pageHighlights = highlights.filter((h) => h.page_number === currentPage);

  return (
    <div
      className={`reader-viewport ${isDistractionFree ? "distraction-free" : ""}`}
      ref={containerRef}
      onMouseUp={handleMouseUp}
    >
      {/* Scanned PDF Notice */}
      {isScanned && (
        <div className="scanned-pdf-banner">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div>
            <strong>Rasterized / Scanned Document:</strong> This PDF contains raster image pages without an
            embedded text layer. Passage text selection is unavailable, but page navigation and page-level notes
            remain functional.
          </div>
        </div>
      )}

      {/* Zoom Bar */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
        <button
          className="reader-nav-btn"
          onClick={() => setScale((s) => Math.max(0.6, +(s - 0.15).toFixed(2)))}
          title="Zoom out (-)"
        >
          -
        </button>
        <span style={{ fontSize: "0.78rem", color: "var(--text-dim)", minWidth: "44px", textAlign: "center" }}>
          {Math.round(scale * 100)}%
        </span>
        <button
          className="reader-nav-btn"
          onClick={() => setScale((s) => Math.min(2.5, +(s + 0.15).toFixed(2)))}
          title="Zoom in (+)"
        >
          +
        </button>
        <button
          className="card-action-link"
          style={{ fontSize: "0.75rem", border: "1px solid var(--border-subtle)", borderRadius: "3px", padding: "2px 6px" }}
          onClick={() => setScale(1.25)}
          title="Reset zoom"
        >
          Reset
        </button>
      </div>

      {/* Rendered PDF Page with Text and Highlights Overlays */}
      <div
        className="pdf-page-container"
        ref={pageContainerRef}
        style={{ position: "relative" }}
      >
        <canvas ref={canvasRef} className="pdf-canvas" />
        <div ref={textLayerRef} className="pdf-text-layer textLayer" />

        {/* Highlight Overlays Layer */}
        <div className="pdf-highlights-layer">
          {pageHighlights.map((hl) => {
            try {
              const data = JSON.parse(hl.anchor_data);
              if (data.rects && Array.isArray(data.rects)) {
                return data.rects.map((r: any, idx: number) => (
                  <div
                    key={`${hl.id}-${idx}`}
                    className={`highlight-box type-${hl.highlight_type} ${
                      selectedHighlightId === hl.id ? "is-selected" : ""
                    }`}
                    style={{
                      left: `${r.left * scale}px`,
                      top: `${r.top * scale}px`,
                      width: `${r.width * scale}px`,
                      height: `${r.height * scale}px`,
                    }}
                    title={`${hl.highlight_type.toUpperCase()}: "${hl.selected_text}"${
                      hl.annotation ? `\nNote: ${hl.annotation.content}` : ""
                    }`}
                    onClick={(e: ReactMouseEvent) => {
                      e.stopPropagation();
                      setSelectedHighlightId(hl.id);
                      onHighlightSelected?.(hl.id);
                    }}
                  />
                ));
              }
            } catch (e) {
              return null;
            }
            return null;
          })}
        </div>

        {/* Floating Selection Toolbar */}
        {selectionRange && (
          <FloatingSelectionToolbar
            position={selectionRange.toolbarPos}
            onHighlight={(type) => handleCreateHighlight(type)}
            onAddNote={handleAddNoteToSelection}
            onConnectExcerpt={handleConnectSelection}
            onClose={() => setSelectionRange(null)}
          />
        )}
      </div>

      {/* Connect Excerpt to Knowledge Modal */}
      {connectHighlight && (
        <ConnectExcerptModal
          highlight={connectHighlight}
          documentTitle={documentTitle}
          onClose={() => setConnectHighlight(null)}
          onRecordCreated={(recId) => {
            onRecordCreatedFromExcerpt?.(recId);
          }}
          onShowNotice={onShowNotice}
        />
      )}
    </div>
  );
};
