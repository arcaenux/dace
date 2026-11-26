import { useEffect } from "react";
import type { WorkspaceIntentRequest } from "./appIntents.ts";
import { OverlayType, WorkspaceActivityId } from "./types";
import { areShortcutsBlocked } from "./useDismissable.ts";

interface KeyboardShortcutsProps {
  activeOverlay: OverlayType;
  openOverlay: (overlay: OverlayType) => void;
  closeOverlay: () => void;
  toggleFocusSpace: () => Promise<void>;
  isFocusSpace: boolean;
  exitFocusSpace: () => Promise<void>;
  setNotice: (message: string) => void;
  activeActivity: WorkspaceActivityId;
  setActiveActivity: (act: WorkspaceActivityId) => void;
  requestIntent: (request: WorkspaceIntentRequest) => void;
  onToggleNav?: () => void;
}

export function useKeyboardShortcuts({
  activeOverlay,
  openOverlay,
  closeOverlay,
  toggleFocusSpace,
  isFocusSpace,
  exitFocusSpace,
  setNotice,
  activeActivity,
  setActiveActivity,
  requestIntent,
  onToggleNav,
}: KeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape and other keys may already be claimed by a focused overlay.
      if (e.defaultPrevented) return;
      // Modal surfaces such as the Speed Reader own the keyboard while open.
      if (areShortcutsBlocked()) return;

      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable);

      const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      // 1. F11: Toggle Focus Space (always global)
      if (e.key === "F11") {
        e.preventDefault();
        toggleFocusSpace();
        return;
      }

      // 2. Escape: Hierarchical dismissal
      if (e.key === "Escape") {
        e.preventDefault();
        if (activeOverlay !== null) {
          closeOverlay();
          return;
        }

        if (isFocusSpace) {
          exitFocusSpace();
          setNotice("Exited Focus Space");
          return;
        }
        return;
      }

      // 3. Ctrl+K (or Cmd+K): Open/toggle Command Palette
      if (modifier && (e.key === "k" || e.key === "K") && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (activeOverlay === "command-palette") {
          closeOverlay();
        } else {
          openOverlay("command-palette");
        }
        return;
      }

      // 3.1. Ctrl+B (or Cmd+B): Toggle Navigation Rail
      if (modifier && (e.key === "b" || e.key === "B") && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        onToggleNav?.();
        return;
      }

      // 4. Ctrl+Shift+P: Shortcut Discovery reference
      if (modifier && e.shiftKey && (e.key === "p" || e.key === "P") && !e.altKey) {
        e.preventDefault();
        if (activeOverlay === "shortcut-reference") {
          closeOverlay();
        } else {
          openOverlay("shortcut-reference");
        }
        return;
      }

      // Do not trigger global workspace shortcuts behind an active modal overlay
      if (activeOverlay !== null) {
        return;
      }

      // 5. Ctrl+S: Save Active Document
      if (modifier && (e.key === "s" || e.key === "S") && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (activeActivity === "knowledge-desk" || activeActivity === "reader") {
          requestIntent({ type: "save-active" });
        } else {
          setNotice("No active document to save. (Switch to Knowledge Desk)");
        }
        return;
      }

      // 6. Ctrl+N: Create Knowledge Record (prevent browser new window)
      if (modifier && (e.key === "n" || e.key === "N") && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        requestIntent({ type: "new-record" });
        return;
      }

      // 6.1. Ctrl+O: Import Research Document (prevent browser open file)
      if (modifier && (e.key === "o" || e.key === "O") && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        requestIntent({ type: "import-attachment" });
        return;
      }

      // 7. Ctrl+Shift+F: Search Knowledge Records
      if (modifier && e.shiftKey && (e.key === "f" || e.key === "F") && !e.altKey) {
        e.preventDefault();
        requestIntent({ type: "search-records" });
        return;
      }

      // 7.1. Alt+Shift+1 / 2 / 3: Reader layouts (globally advertised shortcuts)
      if (e.altKey && e.shiftKey && !modifier && !isInput) {
        if (e.code === "Digit1" || e.key === "1" || e.key === "!") {
          e.preventDefault();
          requestIntent({ type: "reader-mode", mode: "reading" });
          return;
        } else if (e.code === "Digit2" || e.key === "2" || e.key === "@") {
          e.preventDefault();
          requestIntent({ type: "reader-mode", mode: "research" });
          return;
        } else if (e.code === "Digit3" || e.key === "3" || e.key === "#") {
          e.preventDefault();
          requestIntent({ type: "reader-mode", mode: "writing" });
          return;
        }
      }

      // 8. Alt+1 / Alt+2 / Alt+3 / Alt+4 / Alt+5 Navigation Shortcuts
      if (e.altKey && !modifier && !e.shiftKey) {
        if (e.key === "1") {
          e.preventDefault();
          setActiveActivity("workspace");
          return;
        } else if (e.key === "2") {
          e.preventDefault();
          setActiveActivity("knowledge-desk");
          return;
        } else if (e.key === "3") {
          e.preventDefault();
          setActiveActivity("knowledge-graph");
          return;
        } else if (e.key === "4") {
          e.preventDefault();
          setActiveActivity("reader");
          return;
        } else if (e.key === "5") {
          e.preventDefault();
          setActiveActivity("settings");
          return;
        } else if (e.key === "6") {
          e.preventDefault();
          setActiveActivity("terminal");
          return;
        }
      }

      // Input isolation: do not trigger single-key shortcuts when typing in inputs
      if (isInput) {
        return;
      }

      // 9. Quick help '?' when outside inputs
      if (e.key === "?" && !modifier && !e.altKey) {
        e.preventDefault();
        openOverlay("shortcut-reference");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    activeOverlay,
    openOverlay,
    closeOverlay,
    toggleFocusSpace,
    isFocusSpace,
    exitFocusSpace,
    setNotice,
    activeActivity,
    setActiveActivity,
    requestIntent,
    onToggleNav,
  ]);
}
