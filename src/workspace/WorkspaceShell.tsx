import { FC, useState, useMemo } from "react";
import { WorkspaceActivityId, OverlayType } from "../core/types";
import { buildCommandList } from "../core/commandRegistry";
import { useKeyboardShortcuts } from "../core/useKeyboardShortcuts";
import { useFocusSpace } from "../focus/FocusSpaceContext";
import { WorkspaceNavigation } from "./WorkspaceNavigation";
import { WorkspaceIntro } from "./WorkspaceIntro";
import { ContextualPanel } from "./ContextualPanel";
import { CommandPalette } from "../overlays/CommandPalette";
import { ShortcutReference } from "../overlays/ShortcutReference";
import { FocusSpaceView } from "../focus/FocusSpaceView";
import { KnowledgeDesk } from "../knowledge/KnowledgeDesk";
import { KnowledgeGraphView } from "../graph/KnowledgeGraphView";
import { ResearchReaderView } from "../reader/ResearchReaderView";

export const WorkspaceShell: FC = () => {
  const [activeActivity, setActiveActivity] = useState<WorkspaceActivityId>("workspace");
  const [selectedDeskRecordId, setSelectedDeskRecordId] = useState<string | null>(null);
  const [readerTarget, setReaderTarget] = useState<{ attachmentId: string; pageNumber: number } | null>(null);
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(false);

  const { isFocusSpace, enterFocusSpace, exitFocusSpace, toggleFocusSpace, fullscreenError } =
    useFocusSpace();

  // Helper to show unobtrusive notification
  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => {
      setNotice((current) => (current === msg ? null : current));
    }, 3200);
  };

  const closeOverlay = () => {
    setActiveOverlay(null);
  };

  const openOverlay = (overlay: OverlayType) => {
    setActiveOverlay(overlay);
  };

  // Build the command registry dynamically based on active state
  const commandList = useMemo(() => {
    return buildCommandList({
      activeActivity,
      setActiveActivity,
      isFocusSpace,
      enterFocusSpace,
      exitFocusSpace,
      toggleFocusSpace,
      openOverlay: (ov) => openOverlay(ov),
      closeOverlay,
      setNotice: showNotice,
    });
  }, [activeActivity, isFocusSpace, enterFocusSpace, exitFocusSpace, toggleFocusSpace]);

  // Wire up global keyboard shortcuts
  useKeyboardShortcuts({
    activeOverlay,
    openOverlay,
    closeOverlay,
    toggleFocusSpace,
    isFocusSpace,
    exitFocusSpace,
    setNotice: showNotice,
    activeActivity,
    setActiveActivity,
  });

  return (
    <div className="nova-app">
      {/* 1. Quiet Navigation Header */}
      <WorkspaceNavigation
        activeActivity={activeActivity}
        isFocusSpace={isFocusSpace}
        onOpenCommands={() => openOverlay("command-palette")}
        onOpenShortcuts={() => openOverlay("shortcut-reference")}
        onTogglePanel={() => setIsPanelOpen(!isPanelOpen)}
        isPanelOpen={isPanelOpen}
      />

      {/* 2. Main Workspace Layout */}
      <main className={`workspace-body ${isFocusSpace ? "fullscreen" : ""}`}>
        <FocusSpaceView onOpenCommands={() => openOverlay("command-palette")}>
          <div className="central-workspace">
            {activeActivity === "workspace" && (
              <WorkspaceIntro
                onOpenCommands={() => openOverlay("command-palette")}
                onOpenShortcuts={() => openOverlay("shortcut-reference")}
                onEnterFocus={() => enterFocusSpace()}
              />
            )}

            {activeActivity === "knowledge-desk" && (
              <KnowledgeDesk
                onShowNotice={showNotice}
                initialRecordId={selectedDeskRecordId}
                onOpenInReader={(attId, pageNum) => {
                  setReaderTarget({ attachmentId: attId, pageNumber: pageNum });
                  setActiveActivity("reader");
                }}
              />
            )}

            {activeActivity === "reader" && (
              <ResearchReaderView
                initialAttachmentId={readerTarget?.attachmentId}
                initialPage={readerTarget?.pageNumber}
                onNavigateToRecord={(recordId) => {
                  setSelectedDeskRecordId(recordId);
                  setActiveActivity("knowledge-desk");
                }}
                onShowNotice={showNotice}
              />
            )}

            {activeActivity === "knowledge-graph" && (
              <KnowledgeGraphView
                onOpenRecordInDesk={(recordId) => {
                  setSelectedDeskRecordId(recordId);
                  setActiveActivity("knowledge-desk");
                }}
                onShowNotice={showNotice}
              />
            )}

            {activeActivity !== "workspace" &&
              activeActivity !== "knowledge-desk" &&
              activeActivity !== "reader" &&
              activeActivity !== "knowledge-graph" && (
              <div className="activity-placeholder">
                <span className="activity-badge-large">Planned Module</span>
                <h2 className="activity-title">
                  {activeActivity.replace("-", " ").toUpperCase()}
                </h2>
                <p className="activity-desc">
                  This capability is scheduled for subsequent milestone releases as specified in
                  the NOVA DOME roadmap.
                </p>
                <button
                  className="activity-back-btn"
                  onClick={() => setActiveActivity("workspace")}
                >
                  Return to Workspace
                </button>
              </div>
            )}
          </div>
        </FocusSpaceView>

        {/* 3. Contextual Details Panel (Revealed on demand) */}
        <ContextualPanel
          isOpen={isPanelOpen && !isFocusSpace}
          title="Workspace Details"
          onClose={() => setIsPanelOpen(false)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div>
              <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Current Activity
              </div>
              <div style={{ fontWeight: 500, color: "var(--text-primary)", marginTop: "4px" }}>
                {activeActivity === "workspace"
                  ? "General Workspace"
                  : activeActivity === "knowledge-desk"
                  ? "Knowledge Desk (SQLite Active)"
                  : activeActivity === "knowledge-graph"
                  ? "Interactive Knowledge Graph (Cosmos Active)"
                  : activeActivity}
              </div>
            </div>

            <div>
              <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Focus Space
              </div>
              <div style={{ color: "var(--text-secondary)", marginTop: "4px" }}>
                {isFocusSpace ? "Active (Distraction-Free)" : "Standard Windowed Mode"}
              </div>
            </div>

            <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border-subtle)", fontSize: "var(--font-size-xs)", color: "var(--text-muted)", lineHeight: "1.5" }}>
              Panels in NOVA DOME only consume screen space when summoned. Dismiss this panel by pressing <kbd style={{ padding: "1px 4px", background: "var(--bg-surface-elevated)", border: "1px solid var(--border-subtle)" }}>Esc</kbd> or clicking the close button.
            </div>
          </div>
        </ContextualPanel>
      </main>

      {/* 4. Command Palette Overlay (Ctrl+K) */}
      <CommandPalette
        commands={commandList}
        isOpen={activeOverlay === "command-palette"}
        onClose={closeOverlay}
      />

      {/* 5. Shortcut Discovery Reference Overlay (Ctrl+Shift+P) */}
      <ShortcutReference
        isOpen={activeOverlay === "shortcut-reference"}
        onClose={closeOverlay}
      />

      {/* 6. Quiet Notifications & Error Feedback */}
      {(notice || fullscreenError) && (
        <div className="quiet-notice" role="status">
          {fullscreenError ? `Note: ${fullscreenError}` : notice}
        </div>
      )}
    </div>
  );
};
