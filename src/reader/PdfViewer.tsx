import {
  FC,
  memo,
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { Highlight, HighlightType, OutlineItem } from "./types.ts";
import { FloatingSelectionToolbar } from "./FloatingSelectionToolbar.tsx";
import { ConnectExcerptModal } from "./ConnectExcerptModal.tsx";
import * as readerApi from "./readerApi.ts";
import {
  createAnchorData,
  findExistingHighlight,
  parseAnchorData,
  resolveOutlinePageNumbers,
  type PassageRect,
} from "./readerSelection.ts";
import { pdfItemsToText } from "./speedRead.ts";

// Configure workerSrc — this deliberately preserves the existing worker setup.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * pdf.js would otherwise *fetch* a data: URL from its worker, which the app's
 * Content-Security-Policy (connect-src) rightly blocks in release builds —
 * every PDF failed with "Unexpected server response (0)". Decoding to bytes
 * here hands pdf.js the document directly, with no network request at all.
 */
export function pdfSourceFromDataUrl(url: string): string | { data: Uint8Array } {
  if (!url.startsWith("data:")) return url;
  const comma = url.indexOf(",");
  const meta = url.slice(5, comma);
  const payload = url.slice(comma + 1);
  if (!meta.includes(";base64")) {
    return { data: new TextEncoder().encode(decodeURIComponent(payload)) };
  }
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { data: bytes };
}

interface PdfViewerProps {
  dataUrl: string;
  attachmentId: string;
  documentTitle: string;
  highlights: Highlight[];
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onTotalPagesDetected: (total: number) => void;
  onOutlineLoaded?: (outline: OutlineItem[]) => void;
  onHighlightCreated: (highlight: Highlight) => void;
  onHighlightSelected?: (highlightId: string) => void;
  onAnnotationRequested?: (highlightId: string) => void;
  onRecordCreatedFromExcerpt?: (recordId: string) => void;
  onExcerptAdded?: (highlight: Highlight) => Promise<void>;
  onShowNotice: (msg: string) => void;
  isDistractionFree?: boolean;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  fitWidth: boolean;
  onFitWidthChange: (fit: boolean) => void;
  annotationType?: HighlightType | null;
  selectedHighlightId?: string | null;
  initialScrollTop?: number;
  onScrollTopChange?: (top: number) => void;
  onPageTextLoaded?: (text: string, page: number) => void;
  onSpeedRead?: (text: string) => void;
}

interface SelectionCapture {
  text: string;
  rects: PassageRect[];
  toolbarPos: { top: number; left: number };
}

const PdfViewerComponent: FC<PdfViewerProps> = ({
  dataUrl,
  attachmentId,
  documentTitle,
  highlights,
  currentPage,
  totalPages,
  onPageChange,
  onTotalPagesDetected,
  onOutlineLoaded,
  onHighlightCreated,
  onHighlightSelected,
  onAnnotationRequested,
  onRecordCreatedFromExcerpt,
  onExcerptAdded,
  onShowNotice,
  isDistractionFree = false,
  zoom,
  onZoomChange,
  fitWidth,
  onFitWidthChange,
  annotationType = null,
  selectedHighlightId = null,
  initialScrollTop = 0,
  onScrollTopChange,
  onPageTextLoaded,
  onSpeedRead,
}) => {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [basePageWidth, setBasePageWidth] = useState<number>(0);
  const [isScanned, setIsScanned] = useState<boolean>(false);
  const [selectionRange, setSelectionRange] = useState<SelectionCapture | null>(null);
  const [connectHighlight, setConnectHighlight] = useState<Highlight | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<any>(null);
  const zoomRef = useRef(zoom);
  const basePageWidthRef = useRef(0);
  const pageRef = useRef(currentPage);
  const totalPagesRef = useRef(totalPages);
  const highlightsRef = useRef(highlights);
  const restoredScrollRef = useRef(false);
  const lastPageRef = useRef(currentPage);
  const scrollFrameRef = useRef<number | null>(null);
  // Scroll restoration is a one-time mount concern, not a render input.
  const initialScrollTopRef = useRef(initialScrollTop);

  const callbacksRef = useRef({
    onPageChange,
    onTotalPagesDetected,
    onOutlineLoaded,
    onHighlightCreated,
    onHighlightSelected,
    onAnnotationRequested,
    onRecordCreatedFromExcerpt,
    onExcerptAdded,
    onShowNotice,
    onZoomChange,
    onFitWidthChange,
    onScrollTopChange,
    onPageTextLoaded,
    onSpeedRead,
  });
  callbacksRef.current = {
    onPageChange,
    onTotalPagesDetected,
    onOutlineLoaded,
    onHighlightCreated,
    onHighlightSelected,
    onAnnotationRequested,
    onRecordCreatedFromExcerpt,
    onExcerptAdded,
    onShowNotice,
    onZoomChange,
    onFitWidthChange,
    onScrollTopChange,
    onPageTextLoaded,
    onSpeedRead,
  };

  zoomRef.current = zoom;
  pageRef.current = currentPage;
  totalPagesRef.current = totalPages;
  highlightsRef.current = highlights;

  const scale = zoom;

  // 1. Load the document. Callback props are read through refs so an inline
  // parent callback can never restart parsing/loading on an unrelated render.
  useEffect(() => {
    if (!dataUrl) return;
    let cancelled = false;
    let loadingTask: any = null;
    let loadedDoc: pdfjsLib.PDFDocumentProxy | null = null;

    async function loadPdf() {
      try {
        loadingTask = pdfjsLib.getDocument(pdfSourceFromDataUrl(dataUrl));
        const documentProxy = await loadingTask.promise;
        loadedDoc = documentProxy;
        if (cancelled) {
          void loadingTask?.destroy?.();
          return;
        }

        setPdfDoc(documentProxy);
        callbacksRef.current.onTotalPagesDetected(documentProxy.numPages);

        try {
          const rawOutline = await documentProxy.getOutline();
          if (rawOutline && callbacksRef.current.onOutlineLoaded) {
            const parsed = await resolveOutlinePageNumbers(documentProxy, rawOutline);
            if (!cancelled) callbacksRef.current.onOutlineLoaded(parsed);
          }
        } catch (error) {
          console.warn("Could not extract PDF outline:", error);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error("Error loading PDF document:", err);
          callbacksRef.current.onShowNotice(`Failed to render PDF: ${err?.message || err}`);
        }
      }
    }

    void loadPdf();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel?.();
      setSelectionRange(null);
      // Destroy the document/worker resources. If parsing never completed,
      // destroy the loading task instead.
      const teardown = loadedDoc?.destroy?.() || loadingTask?.destroy?.();
      void teardown?.catch?.(() => {});
    };
  }, [dataUrl]);

  // 2. Render only the active page, and cancel all async work on cleanup.
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    let activePage: any = null;
    let activeTextLayer: any = null;

    async function renderPage() {
      try {
        renderTaskRef.current?.cancel?.();
        const pageNumber = Math.min(Math.max(1, currentPage), pdfDoc!.numPages);
        activePage = await pdfDoc!.getPage(pageNumber);
        if (cancelled) return;

        const viewport = activePage.getViewport({ scale });
        const unscaledWidth = activePage.getViewport({ scale: 1 }).width;
        if (Math.abs(unscaledWidth - basePageWidthRef.current) > 0.5) {
          basePageWidthRef.current = unscaledWidth;
          setBasePageWidth(unscaledWidth);
        }

        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        if (pageContainerRef.current) {
          pageContainerRef.current.style.width = `${Math.floor(viewport.width)}px`;
          pageContainerRef.current.style.height = `${Math.floor(viewport.height)}px`;
        }

        if (!restoredScrollRef.current && containerRef.current && initialScrollTopRef.current > 0) {
          containerRef.current.scrollTop = initialScrollTopRef.current;
        }
        restoredScrollRef.current = true;

        const renderTask = activePage.render({
          canvasContext: context,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (cancelled) return;

        const textLayerDiv = textLayerRef.current;
        if (!textLayerDiv) return;
        textLayerDiv.innerHTML = "";
        textLayerDiv.style.width = `${Math.floor(viewport.width)}px`;
        textLayerDiv.style.height = `${Math.floor(viewport.height)}px`;
        textLayerDiv.style.setProperty("--scale-factor", `${scale}`);

        const textContent = await activePage.getTextContent();
        if (cancelled) return;

        callbacksRef.current.onPageTextLoaded?.(
          pdfItemsToText(textContent.items as Array<{ str?: string; hasEOL?: boolean }>),
          pageNumber
        );

        if (textContent.items.length === 0) {
          setIsScanned(true);
        } else {
          setIsScanned(false);
          activeTextLayer = new pdfjsLib.TextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport,
          });
          await activeTextLayer.render();
        }
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException" && !cancelled) {
          console.error("Error rendering PDF page:", err);
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel?.();
      activeTextLayer?.cancel?.();
      activePage?.cleanup?.();
    };
  }, [pdfDoc, currentPage, scale]);

  // Fit-to-width is debounced and skipped mid-drag so resizing cannot trigger a
  // cascade of page rerenders.
  useEffect(() => {
    const element = containerRef.current;
    if (!fitWidth || !element || basePageWidth <= 0 || typeof ResizeObserver === "undefined") return;
    let timer: number | null = null;

    const applyFit = () => {
      if (document.body.classList.contains("reader-is-resizing")) return;
      const styles = window.getComputedStyle(element);
      const horizontalPadding =
        (Number.parseFloat(styles.paddingLeft) || 0) +
        (Number.parseFloat(styles.paddingRight) || 0);
      const available = element.clientWidth - horizontalPadding - 16;
      if (available <= 0) return;
      const next = Math.min(2.5, Math.max(0.6, +(available / basePageWidth).toFixed(2)));
      if (Math.abs(next - zoomRef.current) > 0.02) callbacksRef.current.onZoomChange(next);
    };

    const observer = new ResizeObserver(() => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(applyFit, 140);
    });
    observer.observe(element);
    applyFit();

    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [fitWidth, basePageWidth]);

  // Explicit page navigation starts at the top of the new page. Restoring the
  // saved position on mount is handled by initialScrollTop above.
  useEffect(() => {
    if (lastPageRef.current !== currentPage) {
      containerRef.current?.scrollTo({ top: 0 });
      lastPageRef.current = currentPage;
    }
  }, [currentPage]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onScroll = () => {
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        callbacksRef.current.onScrollTopChange?.(element.scrollTop);
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    };
  }, []);

  useEffect(() => {
    setSelectionRange(null);
  }, [currentPage, scale, dataUrl]);

  const clearSelection = useCallback(() => {
    setSelectionRange(null);
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) selection.removeAllRanges();
  }, []);

  const handleMouseUp = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    // Toolbar clicks must not re-capture the selection they just acted on.
    if ((event.target as HTMLElement | null)?.closest?.(".floating-selection-toolbar")) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setSelectionRange(null);
      return;
    }

    // Store the exact text. Empty/whitespace-only selections are ignored.
    const text = selection.toString();
    if (!text.trim()) {
      setSelectionRange(null);
      return;
    }

    const pageContainer = pageContainerRef.current;
    if (!pageContainer) return;

    const range = selection.getRangeAt(0);
    if (!pageContainer.contains(range.commonAncestorContainer)) {
      setSelectionRange(null);
      return;
    }

    const pageRect = pageContainer.getBoundingClientRect();
    const rangeRect = range.getBoundingClientRect();
    const clientRects = range.getClientRects();
    const rects: PassageRect[] = [];
    for (let i = 0; i < clientRects.length; i++) {
      const cr = clientRects[i];
      if (cr.width <= 0 && cr.height <= 0) continue;
      rects.push({
        left: (cr.left - pageRect.left) / scale,
        top: (cr.top - pageRect.top) / scale,
        width: cr.width / scale,
        height: cr.height / scale,
      });
    }

    setSelectionRange({
      text,
      rects,
      toolbarPos: {
        top: rangeRect.top - pageRect.top,
        left: rangeRect.left - pageRect.left + rangeRect.width / 2 - 120,
      },
    });
  }, [scale]);

  const ensureHighlight = useCallback(
    async (type: HighlightType, annotationContent?: string | null) => {
      const selection = selectionRange;
      if (!selection) return null;

      const identity = { attachmentId, page: currentPage, text: selection.text };
      const existing = findExistingHighlight(highlightsRef.current, identity);
      if (existing) return existing;

      const highlight = await readerApi.createHighlight({
        attachment_id: attachmentId,
        page_number: currentPage,
        selected_text: selection.text,
        anchor_data: createAnchorData({
          rects: selection.rects,
          pageNumber: currentPage,
          text: selection.text,
        }),
        highlight_type: type,
        annotation_content: annotationContent || null,
      });
      callbacksRef.current.onHighlightCreated(highlight);
      return highlight;
    },
    [attachmentId, currentPage, selectionRange]
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

  const handleAddNoteToSelection = useCallback(() => {
    void withSelectionAction(async () => {
      const highlight = await ensureHighlight(annotationType || "insight");
      if (!highlight) return;
      callbacksRef.current.onAnnotationRequested?.(highlight.id);
    });
  }, [annotationType, ensureHighlight, withSelectionAction]);

  const handleAddToNotesSelection = useCallback(() => {
    void withSelectionAction(async () => {
      const highlight = await ensureHighlight(annotationType || "insight");
      if (!highlight || !callbacksRef.current.onExcerptAdded) return;
      await callbacksRef.current.onExcerptAdded(highlight);
    });
  }, [annotationType, ensureHighlight, withSelectionAction]);

  const handleCreateExcerptSelection = useCallback(() => {
    void withSelectionAction(async () => {
      const identity = { attachmentId, page: currentPage, text: selectionRange?.text || "" };
      if (findExistingHighlight(highlightsRef.current, identity)) {
        callbacksRef.current.onShowNotice("Excerpt already captured");
        return;
      }
      const highlight = await ensureHighlight(annotationType || "important");
      if (!highlight) return;
      callbacksRef.current.onShowNotice("Excerpt captured from this passage");
    });
  }, [annotationType, attachmentId, currentPage, ensureHighlight, selectionRange, withSelectionAction]);

  const handleConnectSelection = useCallback(() => {
    void withSelectionAction(async () => {
      const highlight = await ensureHighlight("important");
      if (highlight) setConnectHighlight(highlight);
    });
  }, [ensureHighlight, withSelectionAction]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.getAttribute?.("role") === "separator") return;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable ||
        target?.closest?.('[role="dialog"]')
      ) {
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        if (pageRef.current > 1) {
          event.preventDefault();
          callbacksRef.current.onPageChange(pageRef.current - 1);
        }
      } else if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        if (pageRef.current < totalPagesRef.current) {
          event.preventDefault();
          callbacksRef.current.onPageChange(pageRef.current + 1);
        }
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        callbacksRef.current.onZoomChange(Math.min(2.5, +(zoomRef.current + 0.15).toFixed(2)));
        callbacksRef.current.onFitWidthChange(false);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        callbacksRef.current.onZoomChange(Math.max(0.6, +(zoomRef.current - 0.15).toFixed(2)));
        callbacksRef.current.onFitWidthChange(false);
      } else if (event.key === "0") {
        event.preventDefault();
        callbacksRef.current.onFitWidthChange(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const pageHighlights = useMemo(
    () => highlights.filter(
      (highlight) => highlight.page_number === currentPage && !highlight.is_stale
    ),
    [highlights, currentPage]
  );

  return (
    <div
      className={`reader-viewport ${isDistractionFree ? "distraction-free" : ""}`}
      ref={containerRef}
      onMouseUp={handleMouseUp}
    >
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

      <div className="pdf-page-container" ref={pageContainerRef} style={{ position: "relative" }}>
        <canvas ref={canvasRef} className="pdf-canvas" />
        <div ref={textLayerRef} className="pdf-text-layer textLayer" />

        <div className="pdf-highlights-layer">
          {pageHighlights.map((highlight) => {
            const anchor = parseAnchorData(highlight.anchor_data);
            if (!anchor?.rects || !Array.isArray(anchor.rects)) return null;
            return anchor.rects.map((rect, index) => (
              <div
                key={`${highlight.id}-${index}`}
                className={`highlight-box type-${highlight.highlight_type} ${
                  selectedHighlightId === highlight.id ? "is-selected" : ""
                }`}
                style={{
                  left: `${rect.left * scale}px`,
                  top: `${rect.top * scale}px`,
                  width: `${rect.width * scale}px`,
                  height: `${rect.height * scale}px`,
                }}
                title={`${highlight.highlight_type.toUpperCase()}: "${highlight.selected_text}"${
                  highlight.annotation ? `\nNote: ${highlight.annotation.content}` : ""
                }`}
                onClick={(event: ReactMouseEvent) => {
                  event.stopPropagation();
                  callbacksRef.current.onHighlightSelected?.(highlight.id);
                }}
              />
            ));
          })}
        </div>

        {selectionRange && (
          <FloatingSelectionToolbar
            position={selectionRange.toolbarPos}
            onHighlight={handleCreateHighlight}
            onAddNote={handleAddNoteToSelection}
            onAddToNotes={handleAddToNotesSelection}
            onExcerpt={handleCreateExcerptSelection}
            onConnectExcerpt={handleConnectSelection}
            onSpeedRead={() => callbacksRef.current.onSpeedRead?.(selectionRange.text)}
            onClose={clearSelection}
            preferredType={annotationType}
          />
        )}
      </div>

      {connectHighlight && (
        <ConnectExcerptModal
          highlight={connectHighlight}
          documentTitle={documentTitle}
          onClose={() => setConnectHighlight(null)}
          onRecordCreated={(recId) => callbacksRef.current.onRecordCreatedFromExcerpt?.(recId)}
          onShowNotice={onShowNotice}
        />
      )}
    </div>
  );
};

export const PdfViewer = memo(PdfViewerComponent);
