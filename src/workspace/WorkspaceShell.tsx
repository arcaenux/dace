import { FC, useState, useMemo, useRef, useCallback, useEffect } from "react";
import { WorkspaceActivityId, OverlayType } from "../core/types";
import { buildCommandList } from "../core/commandRegistry";
import { useKeyboardShortcuts } from "../core/useKeyboardShortcuts";
import { useFocusSpace } from "../focus/FocusSpaceContext";
import { WorkspaceRail } from "./WorkspaceRail";
import { WorkspaceTopBar } from "./WorkspaceTopBar";
import { WindowControls } from "./WindowControls";
import { WorkspaceIntro } from "./WorkspaceIntro";
import { ContextualPanel } from "./ContextualPanel";
import { CommandPalette } from "../overlays/CommandPalette";
import { ShortcutReference } from "../overlays/ShortcutReference";
import { FocusSpaceView } from "../focus/FocusSpaceView";
import { KnowledgeDesk } from "../knowledge/KnowledgeDesk";
import { KnowledgeGraphView } from "../graph/KnowledgeGraphView";
import { ResearchReaderView } from "../reader/ResearchReaderView";
import { ReaderChromeState } from "../reader/readerLayout.ts";
import { exportBackup, formatBytes } from "../backup/backupApi";
import {
  getRestoreResult,
  inspectBackupArchive,
  restoreBackupArchive,
  RestorePreview,
} from "../backup/restoreApi";
import { RestoreBackupDialog } from "../backup/RestoreBackupDialog";

export const WorkspaceShell: FC = () => {
  const [activeActivity, setActiveActivity] = useState<WorkspaceActivityId>("workspace");
  const [selectedDeskRecordId, setSelectedDeskRecordId] = useState<string | null>(null);
  const [readerTarget, setReaderTarget] = useState<{ attachmentId: string; pageNumber: number } | null>(null);
  const [readerChrome, setReaderChrome] = useState<ReaderChromeState>({
    navigation: "full",
    header: "full",
  });
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(false);
  const noticeTimerRef = useRef<number | null>(null);
  const [isBackupRunning, setIsBackupRunning] = useState(false);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [isRestoreInspecting, setIsRestoreInspecting] = useState(false);
  const [isRestoreRunning, setIsRestoreRunning] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const panelTriggerRef = useRef<HTMLButtonElement>(null);
  const commandsTriggerRef = useRef<HTMLButtonElement>(null);
  const shortcutsTriggerRef = useRef<HTMLButtonElement>(null);

  const { isFocusSpace, enterFocusSpace, exitFocusSpace, toggleFocusSpace, fullscreenError } =
    useFocusSpace();

  // A workspace change dismisses transient drawers so two right-edge surfaces
  // (context panel and reader drawer) can never occupy the same space.
  const selectActivity = useCallback((activity: WorkspaceActivityId) => {
    setIsPanelOpen(false);
    setActiveActivity(activity);
  }, []);

  const handleReaderChromeChange = useCallback((chrome: ReaderChromeState) => {
    setReaderChrome(chrome);
  }, []);

  useEffect(() => {
    if (activeActivity !== "reader") {
      setReaderChrome({ navigation: "full", header: "full" });
    }
  }, [activeActivity]);

  const showNotice = useCallback((msg: string, durationMs = 3200) => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setNotice(msg);
    if (durationMs > 0) {
      noticeTimerRef.current = window.setTimeout(() => {
        setNotice((current) => (current === msg ? null : current));
        noticeTimerRef.current = null;
      }, durationMs);
    }
  }, []);

  const handleExportBackup = useCallback(async () => {
    if (isBackupRunning) {
      showNotice("A backup export is already in progress.", 2500);
      return;
    }
    setIsBackupRunning(true);
    showNotice("Preparing backup export…", 0);
    try {
      const result = await exportBackup((progress) => {
        showNotice(progress.message || "Exporting backup…", 0);
      });
      const sizeLabel = formatBytes(result.archive_size);
      const name = result.archive_path.split(/[/\\]/).pop() || result.archive_path;
      showNotice(
        `Backup exported: ${name} (${sizeLabel}, ${result.attachment_count} attachments).`,
        7000
      );
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Backup export failed.";
      if (/cancelled/i.test(msg)) {
        showNotice("Backup export cancelled.", 3000);
      } else {
        showNotice(`Backup failed: ${msg}`, 9000);
      }
    } finally {
      setIsBackupRunning(false);
    }
  }, [isBackupRunning, showNotice]);

  const handleRestoreBackup = useCallback(async () => {
    if (isRestoreInspecting || isRestoreRunning) {
      showNotice("A backup operation is already in progress.", 2500);
      return;
    }
    if (isBackupRunning) {
      showNotice("Wait for the current backup export to finish.", 3000);
      return;
    }
    setIsRestoreInspecting(true);
    setRestoreError(null);
    showNotice("Select a Dace backup to validate…", 0);
    try {
      const preview = await inspectBackupArchive();
      setRestorePreview(preview);
      showNotice("Backup validated. Review the restore summary.", 4000);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Could not validate backup.";
      if (/cancelled/i.test(msg)) {
        showNotice("Restore cancelled.", 3000);
      } else {
        showNotice(`Restore validation failed: ${msg}`, 10000);
      }
    } finally {
      setIsRestoreInspecting(false);
    }
  }, [isBackupRunning, isRestoreInspecting, isRestoreRunning, showNotice]);

  const confirmRestore = useCallback(async () => {
    if (!restorePreview || isRestoreRunning) return;
    setIsRestoreRunning(true);
    setRestoreError(null);
    setRestoreProgress("Preparing restore…");
    showNotice("Preparing restore…", 0);
    try {
      await restoreBackupArchive(restorePreview.archive_path, (progress) => {
        const message = progress.message || "Preparing restore…";
        setRestoreProgress(message);
        showNotice(message, 0);
      });
      setRestoreProgress("Restore staged. Dace will restart and verify the restored library…");
      showNotice("Restore staged. Dace will restart and verify the restored library…", 0);
      // Unmount the busy dialog once staging succeeds; the restart is detached and
      // may fail or be delayed, and a mounted busy dialog cannot be dismissed.
      setRestorePreview(null);
      setIsRestoreRunning(false);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Restore failed.";
      setRestoreError(msg);
      setRestoreProgress(null);
      showNotice(`Restore failed: ${msg}`, 12000);
      setIsRestoreRunning(false);
    }
  }, [restorePreview, isRestoreRunning, showNotice]);

  const cancelRestore = useCallback(() => {
    if (isRestoreRunning) return;
    setRestorePreview(null);
    setRestoreError(null);
    setRestoreProgress(null);
  }, [isRestoreRunning]);

  // Report the outcome of a restore applied during startup exactly once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const outcome = await getRestoreResult();
        if (!outcome || cancelled) return;
        if (outcome.success) {
          showNotice(
            `Restore complete — ${outcome.record_count ?? 0} records and ${
              outcome.attachment_count ?? 0
            } attachments verified.`,
            10000
          );
        } else {
          showNotice(`Restore failed: ${outcome.message}`, 16000);
        }
      } catch {
        // Ignore unavailable result state outside the desktop shell.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showNotice]);

  useEffect(() => {
    const onRestore = () => {
      void handleRestoreBackup();
    };
    window.addEventListener("dace:restore-backup", onRestore);
    return () => window.removeEventListener("dace:restore-backup", onRestore);
  }, [handleRestoreBackup]);

  useEffect(() => {
    const onExport = () => {
      void handleExportBackup();
    };
    window.addEventListener("dace:export-backup", onExport);
    return () => window.removeEventListener("dace:export-backup", onExport);
  }, [handleExportBackup]);

  const closeOverlay = () => setActiveOverlay(null);
  const openOverlay = (overlay: OverlayType) => setActiveOverlay(overlay);

  const commandList = useMemo(() => {
    return buildCommandList({
      activeActivity,
      setActiveActivity: selectActivity,
      isFocusSpace,
      enterFocusSpace,
      exitFocusSpace,
      toggleFocusSpace,
      openOverlay: (ov) => openOverlay(ov),
      closeOverlay,
      setNotice: showNotice,
    });
  }, [
    activeActivity,
    isFocusSpace,
    enterFocusSpace,
    exitFocusSpace,
    toggleFocusSpace,
    showNotice,
    selectActivity,
  ]);

  useKeyboardShortcuts({
    activeOverlay,
    openOverlay,
    closeOverlay,
    toggleFocusSpace,
    isFocusSpace,
    exitFocusSpace,
    setNotice: showNotice,
    activeActivity,
    setActiveActivity: selectActivity,
  });

  return (
    <div
      className={`dace-app nova-app reader-nav-${readerChrome.navigation} reader-header-${readerChrome.header}`}
    >
      <div className="stage-decoration" aria-hidden="true">
        <span className="stage-decoration-ring" />
        <span className="stage-decoration-rule" />
      </div>

      <WorkspaceRail
        activeActivity={activeActivity}
        isFocusSpace={isFocusSpace}
        onSelectActivity={selectActivity}
        onTogglePanel={() => setIsPanelOpen((current) => !current)}
        isPanelOpen={isPanelOpen}
        panelTriggerRef={panelTriggerRef}
        hidden={readerChrome.navigation === "hidden"}
        compact={readerChrome.navigation === "compact"}
      />

      <WorkspaceTopBar
        activeActivity={activeActivity}
        isFocusSpace={isFocusSpace}
        hidden={readerChrome.header === "hidden"}
        onOpenCommands={() => openOverlay("command-palette")}
        onOpenShortcuts={() => openOverlay("shortcut-reference")}
        onSearch={() => window.dispatchEvent(new CustomEvent("dace:search-records"))}
        commandsTriggerRef={commandsTriggerRef}
        shortcutsTriggerRef={shortcutsTriggerRef}
      />

      <WindowControls />

      <main className={`workspace-stage ${isFocusSpace ? "focus-active" : ""}`}>
        <FocusSpaceView onOpenCommands={() => openOverlay("command-palette")}>
          <div className="central-workspace">
              {activeActivity === "workspace" && (
                <WorkspaceIntro
                  onOpenCommands={() => openOverlay("command-palette")}
                  onOpenShortcuts={() => openOverlay("shortcut-reference")}
                  onEnterFocus={() => enterFocusSpace()}
                  onOpenKnowledgeDesk={() => selectActivity("knowledge-desk")}
                  onOpenReader={() => selectActivity("reader")}
                  onOpenGraph={() => selectActivity("knowledge-graph")}
                  onOpenRecord={(recordId) => {
                    setSelectedDeskRecordId(recordId);
                    selectActivity("knowledge-desk");
                  }}
                  onExportBackup={handleExportBackup}
                  onRestoreBackup={handleRestoreBackup}
                />
              )}

              {activeActivity === "knowledge-desk" && (
                <KnowledgeDesk
                  onShowNotice={showNotice}
                  initialRecordId={selectedDeskRecordId}
                  onOpenInReader={(attId, pageNum) => {
                    setReaderTarget({ attachmentId: attId, pageNumber: pageNum });
                    selectActivity("reader");
                  }}
                  onOpenGraphView={() => selectActivity("knowledge-graph")}
                />
              )}

              {activeActivity === "reader" && (
                <ResearchReaderView
                  initialAttachmentId={readerTarget?.attachmentId}
                  initialPage={readerTarget?.pageNumber}
                  onNavigateToRecord={(recordId) => {
                    setSelectedDeskRecordId(recordId);
                    selectActivity("knowledge-desk");
                  }}
                  onShowNotice={showNotice}
                  isFocusSpace={isFocusSpace}
                  onToggleFocus={() => void toggleFocusSpace()}
                  onChromeChange={handleReaderChromeChange}
                />
              )}

              {activeActivity === "knowledge-graph" && (
                <KnowledgeGraphView
                  onOpenRecordInDesk={(recordId) => {
                    setSelectedDeskRecordId(recordId);
                    selectActivity("knowledge-desk");
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
                    the Dace roadmap.
                  </p>
                  <button
                    className="activity-back-btn"
                    onClick={() => selectActivity("workspace")}
                  >
                    Return to Workspace
                  </button>
                </div>
              )}
            </div>
          </FocusSpaceView>

          <ContextualPanel
            isOpen={isPanelOpen && !isFocusSpace}
            title="Workspace Details"
            onClose={() => setIsPanelOpen(false)}
            triggerRef={panelTriggerRef}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <div>
                <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--font-mono)" }}>
                  Current Activity
                </div>
                <div style={{ fontWeight: 600, color: "var(--text-primary)", marginTop: "4px" }}>
                  {activeActivity === "workspace"
                    ? "General Workspace"
                    : activeActivity === "knowledge-desk"
                    ? "Knowledge Desk (SQLite Active)"
                    : activeActivity === "knowledge-graph"
                    ? "Interactive Knowledge Graph (Cosmos Active)"
                    : activeActivity === "reader"
                    ? "Research Reader"
                    : activeActivity}
                </div>
              </div>

              <div>
                <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--font-mono)" }}>
                  Focus Space
                </div>
                <div style={{ color: "var(--text-secondary)", marginTop: "4px" }}>
                  {isFocusSpace ? "Active (Distraction-Free)" : "Standard Windowed Mode"}
                </div>
              </div>

              <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border-subtle)", fontSize: "var(--font-size-xs)", color: "var(--text-muted)", lineHeight: "1.5", fontFamily: "var(--font-mono)" }}>
                Panels in Dace only consume screen space when summoned. Dismiss with <kbd>Esc</kbd> or the close control.
              </div>
            </div>
        </ContextualPanel>
      </main>

      <CommandPalette
        commands={commandList}
        isOpen={activeOverlay === "command-palette"}
        onClose={closeOverlay}
        triggerRef={commandsTriggerRef}
      />

      <ShortcutReference
        isOpen={activeOverlay === "shortcut-reference"}
        onClose={closeOverlay}
        triggerRef={shortcutsTriggerRef}
      />

      {restorePreview && (
        <RestoreBackupDialog
          preview={restorePreview}
          busy={isRestoreRunning}
          progress={restoreProgress}
          error={restoreError}
          onConfirm={confirmRestore}
          onCancel={cancelRestore}
        />
      )}

      {(notice || fullscreenError) && (
        <div className="quiet-notice" role="status">
          {fullscreenError ? `Note: ${fullscreenError}` : notice}
        </div>
      )}
    </div>
  );
};
