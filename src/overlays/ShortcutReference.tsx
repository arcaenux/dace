import { FC, useRef, RefObject } from "react";
import { ShortcutDefinition } from "../core/types";
import { useDismissable } from "../core/useDismissable";

interface ShortcutReferenceProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: RefObject<HTMLElement | null>;
}

export const ShortcutReference: FC<ShortcutReferenceProps> = ({
  isOpen,
  onClose,
  triggerRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  useDismissable(isOpen, onClose, containerRef, {
    triggerRef,
    group: "workspace-overlay",
    autoFocus: true,
    outsideClickGraceMs: 200,
  });

  if (!isOpen) return null;

  const shortcuts: ShortcutDefinition[] = [
    {
      keyCombo: "Ctrl + K",
      description: "Command Palette",
      context: "Search, filter and execute workspace actions",
      status: "active",
    },
    {
      keyCombo: "Ctrl + Shift + P",
      description: "Shortcut Discovery & Actions",
      context: "Open this reference card at any time",
      status: "active",
    },
    {
      keyCombo: "F11",
      description: "Toggle Focus Space",
      context: "Enter or exit distraction-free full-screen environment",
      status: "active",
    },
    {
      keyCombo: "Ctrl + B",
      description: "Toggle Curved Sidebar",
      context: "Open or hide the navigation rail over the active view, including Focus Space",
      status: "active",
    },
    {
      keyCombo: "Ctrl + S",
      description: "Save Knowledge Record",
      context: "Flush and commit active record to SQLite database",
      status: "active",
    },
    {
      keyCombo: "Ctrl + N",
      description: "New Knowledge Record",
      context: "Create and open a new knowledge record in Knowledge Desk",
      status: "active",
    },
    {
      keyCombo: "Ctrl + O",
      description: "Import Research Document",
      context: "Import and preserve a document in managed storage",
      status: "active",
    },
    {
      keyCombo: "Ctrl + Shift + F",
      description: "Search Knowledge",
      context: "Open records panel and search knowledge in SQLite",
      status: "active",
    },
    {
      keyCombo: "Alt + 1 / 2 / 3 / 4 / 5 / 6",
      description: "Switch Activity",
      context: "Alt+1 Workspace, Alt+2 Desk, Alt+3 Graph, Alt+4 Reader, Alt+5 Settings, Alt+6 Terminal",
      status: "active",
    },
    {
      keyCombo: "Alt + Shift + 1 / 2 / 3",
      description: "Reader Layout",
      context: "Reading, Research, or Writing layout on the active document",
      status: "active",
    },
    {
      keyCombo: "Escape",
      description: "Dismiss Overlay / Back",
      context: "Closes open palette or panel; exits focus mode if clear",
      status: "active",
    },
  ];

  return (
    <div
      className="overlay-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard Shortcuts and Actions"
      onClick={onClose}
    >
      <div className="shortcut-modal" ref={containerRef} onClick={(e) => e.stopPropagation()}>
        <div className="shortcut-modal-header">
          <div className="shortcut-modal-title">Shortcuts & Available Actions</div>
          <button
            className="panel-close-btn"
            onClick={onClose}
            aria-label="Close shortcuts"
            data-overlay-initial-focus
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="shortcut-modal-body">
          {shortcuts.map((item, idx) => (
            <div key={idx} className="shortcut-row">
              <div className="shortcut-desc-wrap">
                <span className="shortcut-desc">{item.description}</span>
                <span className="shortcut-context">{item.context}</span>
              </div>
              <span className={`shortcut-keys ${item.status === "reserved" ? "reserved" : ""}`}>
                {item.keyCombo}
              </span>
            </div>
          ))}
        </div>

        <div className="command-palette-footer">
          <span>Press <kbd style={{ padding: "1px 4px", background: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>Esc</kbd> to return to workspace</span>
          <span>Dace v0.1.0</span>
        </div>
      </div>
    </div>
  );
};
