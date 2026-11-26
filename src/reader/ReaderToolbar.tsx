import {
  FC,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  useEffect,
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
  Gauge,
  MoreHorizontal,
  PanelLeft,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import logoDarkUrl from "../assets/brand/logo.png";
import logoLightUrl from "../assets/brand/logo-light.png";
import { AttachmentSummary } from "../attachments/types.ts";
import { useDismissable } from "../core/useDismissable";
import { useSettings } from "../settings/SettingsContext";
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
  showBrand?: boolean;
  onToggleFocus: () => void;
  showRestoreNavigation: boolean;
  onRestoreNavigation: () => void;
  onResetLayout: () => void;
  onSaveNote: () => void;
  onSpeedRead: () => void;
  isNarrow: boolean;
  /** Permanently delete an imported document (and its highlights). */
  onDeleteDocument?: (attachmentId: string) => Promise<boolean>;
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
  showBrand = false,
  onToggleFocus,
  showRestoreNavigation,
  onRestoreNavigation,
  onResetLayout,
  onSaveNote,
  onSpeedRead,
  isNarrow,
  onDeleteDocument,
}) => {
  const { settings } = useSettings();
  const logoSrc = settings.appearance.colorMode === "light" ? logoLightUrl : logoDarkUrl;
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeletingDocument, setIsDeletingDocument] = useState(false);

  useEffect(() => {
    if (!isDocPickerOpen) setConfirmDeleteId(null);
  }, [isDocPickerOpen]);
  const [pageDraft, setPageDraft] = useState(String(currentPage));
  const overflowRef = useRef<HTMLDivElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);

  useDismissable(isDocPickerOpen, onDocPickerToggle, docPickerRef, {
    triggerRef: docPickerTriggerRef,
    group: "reader-popover",
  });
  useDismissable(isOverflowOpen, () => setIsOverflowOpen(false), overflowRef, {
    triggerRef: overflowTriggerRef,
    group: "reader-popover",
  });

  useEffect(() => {
    setPageDraft(String(currentPage));
  }, [currentPage]);

  const commitPageDraft = () => {
    const parsed = Number.parseInt(pageDraft, 10);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(totalPages, Math.max(1, parsed));
      setPageDraft(String(clamped));
      onPageChange(clamped);
    } else {
      setPageDraft(String(currentPage));
    }
  };

  const handlePageKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commitPageDraft();
    event.currentTarget.blur();
  };

  const clampZoom = (value: number) => Math.min(2.5, Math.max(0.6, +value.toFixed(2)));

  return (
    <header
      className="reader-toolbar"
      aria-label="Research Reader controls"
      data-tauri-drag-region={!isFocusSpace ? "true" : "false"}
    >
      <div className="reader-toolbar-group reader-toolbar-start" data-tauri-drag-region="false">
        {showBrand && (
          <span className="reader-toolbar-brand">
            <img
              src={logoSrc}
              alt=""
              className="reader-toolbar-brand-logo"
              width={18}
              height={18}
              aria-hidden="true"
            />
            <span>DACE</span>
          </span>
        )}

        <div className="reader-toolbar-picker" ref={docPickerRef} data-tauri-drag-region="false">
          <button
            ref={docPickerTriggerRef}
            className="reader-compact-btn reader-doc-trigger"
            onClick={onDocPickerToggle}
            aria-expanded={isDocPickerOpen}
            aria-haspopup="listbox"
            title="Switch research document"
            data-dismiss-ignore
            data-tauri-drag-region="false"
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
                documents.map((document) =>
                  confirmDeleteId === document.id ? (
                    <div key={document.id} className="reader-doc-confirm" role="group" aria-label="Confirm delete">
                      <span>Delete “{document.file_name}” and its highlights?</span>
                      <div className="reader-doc-confirm-actions">
                        <button type="button" onClick={() => setConfirmDeleteId(null)}>
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="is-danger"
                          disabled={isDeletingDocument}
                          onClick={async () => {
                            if (!onDeleteDocument) return;
                            setIsDeletingDocument(true);
                            try {
                              const deleted = await onDeleteDocument(document.id);
                              if (deleted) setConfirmDeleteId(null);
                            } finally {
                              setIsDeletingDocument(false);
                            }
                          }}
                        >
                          {isDeletingDocument ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={document.id} className="reader-doc-row">
                      <button
                        type="button"
                        className={`reader-popover-item ${
                          document.id === activeAttachment?.id ? "active" : ""
                        }`}
                        onClick={() => {
                          onPickDocument(document);
                          onDocPickerToggle();
                        }}
                        title={document.file_name}
                      >
                        <span>{document.file_name}</span>
                      </button>
                      {onDeleteDocument && (
                        <button
                          type="button"
                          className="reader-doc-delete"
                          onClick={() => setConfirmDeleteId(document.id)}
                          title={`Delete ${document.file_name}`}
                          aria-label={`Delete ${document.file_name}`}
                        >
                          <Trash2 size={12} strokeWidth={1.8} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )
                )
              )}
            </div>
          )}
        </div>
      </div>

      <nav className="reader-mode-switch" aria-label="Reader layout" data-tauri-drag-region="false">
        <button
          className={`reader-mode-btn ${mode === "reading" ? "active" : ""}`}
          onClick={() => onModeChange("reading")}
          data-reader-mode="reading"
          title="Reading layout (Alt+Shift+1)"
          aria-pressed={mode === "reading"}
          data-tauri-drag-region="false"
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
          data-tauri-drag-region="false"
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
          data-tauri-drag-region="false"
        >
          <FileText size={13} strokeWidth={1.8} />
          {!isNarrow && <span>Writing</span>}
        </button>
      </nav>

      <div className="reader-toolbar-group reader-toolbar-end" data-tauri-drag-region="false">
        {activeAttachment && (
          <>
            <div className="reader-page-nav" aria-label="Page navigation">
              <button
                className="reader-icon-btn"
                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1}
                title="Previous page"
                data-tauri-drag-region="false"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="reader-page-field">
                <input
                  value={pageDraft}
                  onChange={(event) => setPageDraft(event.target.value)}
                  onBlur={commitPageDraft}
                  onKeyDown={handlePageKey}
                  inputMode="numeric"
                  aria-label="Current page"
                  data-tauri-drag-region="false"
                />
                <span>/ {totalPages}</span>
              </span>
              <button
                className="reader-icon-btn"
                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage >= totalPages}
                title="Next page"
                data-tauri-drag-region="false"
              >
                <ChevronRight size={14} />
              </button>
            </div>

            <button
              className="reader-icon-btn"
              onClick={onSpeedRead}
              title="Speed Read (Ctrl+Shift+R)"
              aria-label="Speed Read"
              data-tauri-drag-region="false"
            >
              <Gauge size={14} />
            </button>
          </>
        )}

        {showRestoreNavigation && (
          <button
            className="reader-icon-btn"
            onClick={onRestoreNavigation}
            title="Restore navigation"
            aria-label="Restore navigation"
            data-tauri-drag-region="false"
          >
            <PanelLeft size={14} />
          </button>
        )}

        <button
          className={`reader-icon-btn ${isFocusSpace ? "active" : ""}`}
          onClick={onToggleFocus}
          title={isFocusSpace ? "Exit focus mode (F11)" : "Enter focus mode (F11)"}
          aria-label={isFocusSpace ? "Exit focus mode" : "Enter focus mode"}
          data-tauri-drag-region="false"
        >
          <Focus size={14} />
        </button>

        {activeAttachment && (
          <div className="reader-toolbar-popover-wrap" ref={overflowRef} data-tauri-drag-region="false">
            <button
              ref={overflowTriggerRef}
              className="reader-icon-btn"
              onClick={() => setIsOverflowOpen((value) => !value)}
              title="More reader actions"
              aria-expanded={isOverflowOpen}
              data-dismiss-ignore
              data-tauri-drag-region="false"
            >
              <MoreHorizontal size={15} />
            </button>
            {isOverflowOpen && (
              <div className="reader-popover reader-overflow-popover">
                <div className="reader-popover-zoom" aria-label="Zoom controls">
                  <button
                    className="reader-icon-btn"
                    onClick={() => onZoomChange(clampZoom(zoom - 0.15))}
                    title="Zoom out"
                    aria-label="Zoom out"
                  >
                    <ZoomOut size={14} />
                  </button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button
                    className="reader-icon-btn"
                    onClick={() => onZoomChange(clampZoom(zoom + 0.15))}
                    title="Zoom in"
                    aria-label="Zoom in"
                  >
                    <ZoomIn size={14} />
                  </button>
                </div>
                <div className="reader-popover-divider" />
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
                <div className="reader-popover-divider" />
                <div className="reader-popover-title">Default highlight</div>
                <button
                  className={`reader-popover-item ${annotationType === null ? "active" : ""}`}
                  onClick={() => {
                    onAnnotationTypeChange(null);
                    setIsOverflowOpen(false);
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
                      setIsOverflowOpen(false);
                    }}
                  >
                    <span className={`hl-dot ${type.value}`} />
                    {type.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
