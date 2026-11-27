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
      description: "Keyboard shortcuts",
      context: "Open this reference at any time",
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
      description: "Show or hide the navigation rail",
      context: "Outside the writing area; while writing, Ctrl + B makes text bold",
      status: "active",
    },
    {
      keyCombo: "Ctrl + Shift + L",
      description: "Light / dark mode",
      context: "Switch between the light and dark appearance",
      status: "active",
    },
    {
      keyCombo: "Ctrl + Shift + A",
      description: "Side browser",
      context: "Show or hide ChatGPT, Gemini or another site beside your work",
      status: "active",
    },
    {
      keyCombo: "Ctrl + B / I / U",
      description: "Bold, italic, underline",
      context: "While writing; or select text to use the formatting toolbar",
      status: "active",
    },
    {
      keyCombo: "Ctrl + S",
      description: "Save now",
      context: "Save the open record or reader note immediately (notes also save automatically)",
      status: "active",
    },
    {
      keyCombo: "Ctrl + N",
      description: "New record",
      context: "Create and open a new record in the Knowledge Desk",
      status: "active",
    },
    {
      keyCombo: "Ctrl + O",
      description: "Import document",
      context: "Import a PDF, Markdown or text file into your library",
      status: "active",
    },
    {
      keyCombo: "Ctrl + Shift + F",
      description: "Search records",
      context: "Open the library and search your records",
      status: "active",
    },
    {
      keyCombo: "Ctrl + Shift + R",
      description: "Speed Read",
      context: "In the Reader: speed-read the selected passage or the open document",
      status: "active",
    },
    {
      keyCombo: "Alt + 1 / 2 / 3 / 4 / 5 / 6",
      description: "Switch workspace",
      context: "Alt+1 Home, Alt+2 Knowledge Desk, Alt+3 Graph, Alt+4 Reader, Alt+5 Settings, Alt+6 Terminal",
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
      description: "Close / back",
      context: "Close the open palette or panel; leave Focus Space when nothing is open",
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
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div
          className="shortcut-modal-body"
          tabIndex={0}
          data-overlay-initial-focus=""
        >
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
          <span>Press <kbd className="shortcut-esc-key">Esc</kbd> to return to workspace</span>
          <span>Dace v0.1.0</span>
        </div>
      </div>
    </div>
  );
};
