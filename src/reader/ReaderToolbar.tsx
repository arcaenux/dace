import {
  FC,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  FileText,
  Focus,
  Highlighter,
  MoreHorizontal,
  PanelLeft,
  Plus,
  RotateCcw,
  Save,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { AttachmentSummary } from "../attachments/types.ts";
import { useDismissable } from "../core/useDismissable";
import { ReaderMode } from "./readerLayout";
import { HighlightType } from "./types.ts";

interface ReaderToolbarProps {
  documents: AttachmentSummary[];
  activeAttachment: AttachmentSummary | null;
  isDocPickerOpen: boolean;
  docPickerRef: RefObject<HTMLDivElement | null>;
  docPickerTriggerRef: RefObject<HTMLButtonElement | null>;
  onDocPickerToggle: () => void;
  onPickDocument: (document: AttachmentSummary) => void;
  onImport: () => void;
  mode: ReaderMode;
  onModeChange: (mode: ReaderMode) => void;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  annotationType: HighlightType | null;
  onAnnotationTypeChange: (type: HighlightType | null) => void;
  isFocusSpace: boolean;
  onToggleFocus: () => void;
  showRestoreNavigation: boolean;
  onRestoreNavigation: () => void;
  onResetLayout: () => void;
  onSaveNote: () => void;
  isNarrow: boolean;
}

const HIGHLIGHT_TYPES: { value: HighlightType; label: string }[] = [
  { value: "important", label: "Important" },
  { value: "question", label: "Question" },
  { value: "insight", label: "Insight" },
  { value: "definition", label: "Definition" },
];

export const ReaderToolbar: FC<ReaderToolbarProps> = ({
  documents,
  activeAttachment,
  isDocPickerOpen,
  docPickerRef,
  docPickerTriggerRef,
  onDocPickerToggle,
  onPickDocument,
  onImport,
  mode,
  onModeChange,
  currentPage,
  totalPages,
  onPageChange,
  zoom,
  onZoomChange,
  annotationType,
  onAnnotationTypeChange,
  isFocusSpace,
  onToggleFocus,
  showRestoreNavigation,
  onRestoreNavigation,
  onResetLayout,
  onSaveNote,
  isNarrow,
}) => {
  const [isAnnotationOpen, setIsAnnotationOpen] = useState(false);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const annotationRef = useRef<HTMLDivElement>(null);
  const annotationTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);

  useDismissable(isDocPickerOpen, onDocPickerToggle, docPickerRef, {
    triggerRef: docPickerTriggerRef,
    group: "reader-popover",
  });
  useDismissable(
    isAnnotationOpen,
    () => setIsAnnotationOpen(false),
    annotationRef,
    { triggerRef: annotationTriggerRef, group: "reader-popover" }
  );
  useDismissable(isOverflowOpen, () => setIsOverflowOpen(false), overflowRef, {
    triggerRef: overflowTriggerRef,
    group: "reader-popover",
  });

  const handlePageKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    const parsed = Number.parseInt(event.currentTarget.value, 10);
    if (Number.isFinite(parsed)) {
      onPageChange(Math.min(totalPages, Math.max(1, parsed)));
    }
  };

  const clampZoom = (value: number) => Math.min(2.5, Math.max(0.6, +value.toFixed(2)));

  return (
    <header className="reader-toolbar" aria-label="Research Reader controls">
      <div className="reader-toolbar-group reader-toolbar-start">
        <span className="reader-toolbar-brand">DACE</span>

        <div className="reader-toolbar-picker" ref={docPickerRef}>
          <button
            ref={docPickerTriggerRef}
            className="reader-compact-btn reader-doc-trigger"
            onClick={onDocPickerToggle}
            aria-expanded={isDocPickerOpen}
            aria-haspopup="listbox"
            title="Switch research document"
            data-dismiss-ignore
          >
            <FileText size={13} strokeWidth={1.8} />
            <span>{activeAttachment ? activeAttachment.file_name : "No document"}</span>
            <ChevronDown size={12} strokeWidth={1.8} />
          </button>

          {isDocPickerOpen && (
            <div className="reader-popover reader-doc-popover" role="listbox">
              <button
                className="reader-popover-action"
                onClick={() => {
                  onImport();
                  onDocPickerToggle();
                }}
              >
                <Plus size={13} /> Import document
              </button>
              {documents.length === 0 ? (
                <div className="reader-popover-empty">No documents in library</div>
              ) : (
                documents.map((document) => (
                  <button
                    key={document.id}
                    className={`reader-popover-item ${
                      document.id === activeAttachment?.id ? "active" : ""
                    }`}
                    onClick={() => {
                      onPickDocument(document);
                      onDocPickerToggle();
                    }}
                  >
                    <span>{document.file_name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <nav className="reader-mode-switch" aria-label="Reader layout">
        <button
          className={`reader-mode-btn ${mode === "reading" ? "active" : ""}`}
          onClick={() => onModeChange("reading")}
          data-reader-mode="reading"
          title="Reading layout (Alt+Shift+1)"
          aria-pressed={mode === "reading"}
        >
          <BookOpen size={13} strokeWidth={1.8} />
          {!isNarrow && <span>Reading</span>}
        </button>
        <button
          className={`reader-mode-btn ${mode === "research" ? "active" : ""}`}
          onClick={() => onModeChange("research")}
          data-reader-mode="research"
          title="Research layout (Alt+Shift+2)"
          aria-pressed={mode === "research"}
        >
          <Columns2 size={13} strokeWidth={1.8} />
          {!isNarrow && <span>Research</span>}
        </button>
        <button
          className={`reader-mode-btn ${mode === "writing" ? "active" : ""}`}
          onClick={() => onModeChange("writing")}
          data-reader-mode="writing"
          title="Writing layout (Alt+Shift+3)"
          aria-pressed={mode === "writing"}
        >
          <FileText size={13} strokeWidth={1.8} />
          {!isNarrow && <span>Writing</span>}
        </button>
      </nav>

      <div className="reader-toolbar-group reader-toolbar-end">
        {activeAttachment && (
          <div className="reader-page-nav" aria-label="Page navigation">
            <button
              className="reader-icon-btn"
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              title="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="reader-page-field">
              <input
                value={currentPage}
                onChange={(event) => {
                  const value = Number.parseInt(event.target.value, 10);
                  if (Number.isFinite(value)) onPageChange(Math.min(totalPages, Math.max(1, value)));
                }}
                onKeyDown={handlePageKey}
                aria-label="Current page"
              />
              <span>/ {totalPages}</span>
            </span>
            <button
              className="reader-icon-btn"
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              title="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        <div className="reader-zoom" aria-label="Zoom controls">
          <button
            className="reader-icon-btn"
            onClick={() => onZoomChange(clampZoom(zoom - 0.15))}
            title="Zoom out"
          >
            <ZoomOut size={14} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="reader-icon-btn"
            onClick={() => onZoomChange(clampZoom(zoom + 0.15))}
            title="Zoom in"
          >
            <ZoomIn size={14} />
          </button>
        </div>

        <div className="reader-toolbar-popover-wrap" ref={annotationRef}>
          <button
            ref={annotationTriggerRef}
            className={`reader-icon-btn ${annotationType ? "active" : ""}`}
            onClick={() => setIsAnnotationOpen((value) => !value)}
            title="Annotation tools"
            aria-expanded={isAnnotationOpen}
            data-dismiss-ignore
          >
            <Highlighter size={14} />
          </button>
          {isAnnotationOpen && (
            <div className="reader-popover reader-annotation-popover">
              <div className="reader-popover-title">Annotation tool</div>
              <button
                className={`reader-popover-item ${annotationType === null ? "active" : ""}`}
                onClick={() => {
                  onAnnotationTypeChange(null);
                  setIsAnnotationOpen(false);
                }}
              >
                Select text
              </button>
              {HIGHLIGHT_TYPES.map((type) => (
                <button
                  key={type.value}
                  className={`reader-popover-item ${annotationType === type.value ? "active" : ""}`}
                  onClick={() => {
                    onAnnotationTypeChange(type.value);
                    setIsAnnotationOpen(false);
                  }}
                >
                  <span className={`hl-dot ${type.value}`} />
                  {type.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {showRestoreNavigation && (
          <button
            className="reader-icon-btn"
            onClick={onRestoreNavigation}
            title="Restore navigation"
            aria-label="Restore navigation"
          >
            <PanelLeft size={14} />
          </button>
        )}

        <button
          className={`reader-icon-btn ${isFocusSpace ? "active" : ""}`}
          onClick={onToggleFocus}
          title={isFocusSpace ? "Exit focus mode (F11)" : "Enter focus mode (F11)"}
          aria-label={isFocusSpace ? "Exit focus mode" : "Enter focus mode"}
        >
          <Focus size={14} />
        </button>

        <div className="reader-toolbar-popover-wrap" ref={overflowRef}>
          <button
            ref={overflowTriggerRef}
            className="reader-icon-btn"
            onClick={() => setIsOverflowOpen((value) => !value)}
            title="More reader actions"
            aria-expanded={isOverflowOpen}
            data-dismiss-ignore
          >
            <MoreHorizontal size={15} />
          </button>
          {isOverflowOpen && (
            <div className="reader-popover reader-overflow-popover">
              <button
                className="reader-popover-action"
                onClick={() => {
                  onImport();
                  setIsOverflowOpen(false);
                }}
              >
                <Plus size={13} /> Import document
              </button>
              <button
                className="reader-popover-action"
                onClick={() => {
                  onSaveNote();
                  setIsOverflowOpen(false);
                }}
              >
                <Save size={13} /> Save note
              </button>
              <button
                className="reader-popover-action"
                onClick={() => {
                  onResetLayout();
                  setIsOverflowOpen(false);
                }}
              >
                <RotateCcw size={13} /> Reset split
              </button>
              {showRestoreNavigation && (
                <button
                  className="reader-popover-action"
                  onClick={() => {
                    onRestoreNavigation();
                    setIsOverflowOpen(false);
                  }}
                >
                  <PanelLeft size={13} /> Restore navigation
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
