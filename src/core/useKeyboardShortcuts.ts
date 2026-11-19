import { useEffect } from "react";
import { OverlayType, WorkspaceActivityId } from "./types";

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
}: KeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape and other keys may already be claimed by a focused overlay.
      if (e.defaultPrevented) return;

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

      // 5. Ctrl+S: Save Active Document
      if (modifier && (e.key === "s" || e.key === "S") && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (activeActivity === "knowledge-desk") {
          window.dispatchEvent(new CustomEvent("dace:save-record"));
          window.dispatchEvent(new CustomEvent("novadome:save-record"));
        } else if (activeActivity === "reader") {
          window.dispatchEvent(new CustomEvent("dace:save-reader-note"));
        } else {
          setNotice("No active document to save. (Switch to Knowledge Desk)");
        }
        return;
      }

      // 6. Ctrl+N: Create Knowledge Record (prevent browser new window)
      if (modifier && (e.key === "n" || e.key === "N") && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setActiveActivity("knowledge-desk");
        window.dispatchEvent(new CustomEvent("dace:new-record"));
        window.dispatchEvent(new CustomEvent("novadome:new-record"));
        return;
      }

      // 6.1. Ctrl+O: Import Research Document (prevent browser open file)
      if (modifier && (e.key === "o" || e.key === "O") && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setActiveActivity("knowledge-desk");
        window.dispatchEvent(new CustomEvent("dace:import-attachment"));
        window.dispatchEvent(new CustomEvent("novadome:import-attachment"));
        return;
      }

      // 7. Ctrl+Shift+F: Search Knowledge Records
      if (modifier && e.shiftKey && (e.key === "f" || e.key === "F") && !e.altKey) {
        e.preventDefault();
        setActiveActivity("knowledge-desk");
        window.dispatchEvent(new CustomEvent("dace:search-records"));
        window.dispatchEvent(new CustomEvent("novadome:search-records"));
        return;
      }

      // 8. Alt+1 / Alt+2 / Alt+3 / Alt+4 Navigation Shortcuts
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
  ]);
}
