import { FC, useState, useMemo, useRef, useCallback, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  consumeWorkspaceIntent,
  createWorkspaceIntent,
  enqueueWorkspaceIntent,
  intentTargetActivity,
  isShellIntent,
  pruneIntentsForActivity,
  isTargetedKnowledgeDeskIntent,
  isTargetedResearchReaderIntent,
  type WorkspaceIntent,
  type WorkspaceIntentRequest,
} from "../core/appIntents.ts";
import { WorkspaceActivityId, OverlayType } from "../core/types";
import {
  activityFromHash,
  hashForActivity,
  isWorkspaceActivity,
} from "./workspaceNavigation";
import { buildCommandList } from "../core/commandRegistry";
import { useKeyboardShortcuts } from "../core/useKeyboardShortcuts";
import { useFocusSpace } from "../focus/FocusSpaceContext";
import { closeNativeWindow, isTauriEnvironment } from "../focus/tauriWindow";
import { useDismissable } from "../core/useDismissable";
import { SaveParticipantRegistry, attemptClose } from "../core/saveRegistry.ts";
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
import { WorkspaceErrorBoundary } from "../core/WorkspaceErrorBoundary";
import {
  getRestoreResult,
  inspectBackupArchive,
  restoreBackupArchive,
  RestorePreview,
} from "../backup/restoreApi";
import { RestoreBackupDialog } from "../backup/RestoreBackupDialog";
import {
  inspectionProgressMessage,
  inspectionSuccessMessage,
  restoreOutcomeNotice,
  restoreStagedMessage,
} from "../backup/restoreMessages.ts";
import { useSettings } from "../settings/SettingsContext";
import { SettingsView } from "../settings/SettingsView";
import { TerminalView } from "../terminal/TerminalView";
import { checkForUpdate } from "../settings/updaterApi";
import { AssistantPanel } from "../assistant/AssistantPanel";
import type { DefaultActivity } from "../settings/types";

const PERSISTABLE_ACTIVITIES: DefaultActivity[] = [
  "workspace",
  "knowledge-desk",
  "reader",
  "knowledge-graph",
];

function isPersistableActivity(activity: WorkspaceActivityId): activity is DefaultActivity {
  return PERSISTABLE_ACTIVITIES.includes(activity as DefaultActivity);
}

export const WorkspaceShell: FC = () => {
  const [activeActivity, setActiveActivity] = useState<WorkspaceActivityId>(() => {
    if (typeof window !== "undefined") {
      return activityFromHash(window.location.hash) ?? "workspace";
    }
    return "workspace";
  });
  const [selectedDeskRecordId, setSelectedDeskRecordId] = useState<string | null>(null);
  const [readerTarget, setReaderTarget] = useState<{ attachmentId: string; pageNumber: number } | null>(null);
  const [readerChrome, setReaderChrome] = useState<ReaderChromeState>({
    navigation: "full",
    header: "full",
  });
  const [intentQueue, setIntentQueue] = useState<WorkspaceIntent[]>([]);
  const intentSequenceRef = useRef(0);
  const consumedIntentIdsRef = useRef<Set<string>>(new Set());
  const saveRegistryRef = useRef(new SaveParticipantRegistry());
  const isClosingRef = useRef(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const closeErrorDialogRef = useRef<HTMLDivElement>(null);
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Side browser (ChatGPT, Gemini…) docked beside whatever is open.
  const [isAssistantOpen, setIsAssistantOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("dace.assistant.open") === "1";
    } catch {
      return false;
    }
  });
  const toggleAssistant = useCallback(() => setIsAssistantOpen((current) => !current), []);
  useEffect(() => {
    try {
      window.localStorage.setItem("dace.assistant.open", isAssistantOpen ? "1" : "0");
    } catch {
      // Storage unavailable: the panel just won't reopen on launch.
    }
  }, [isAssistantOpen]);
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(false);
  const [isRailCollapsed, setIsRailCollapsed] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return (
        localStorage.getItem("dace_nav_collapsed") === "true" ||
        window.location.hash.includes("nav=collapsed")
      );
    }
    return false;
  });
  const [isRailOverlayOpen, setIsRailOverlayOpen] = useState(false);
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

  useDismissable(closeError !== null, () => setCloseError(null), closeErrorDialogRef, {
    group: "desk-dialog",
    autoFocus: true,
  });

  const { isFocusSpace, enterFocusSpace, exitFocusSpace, toggleFocusSpace, fullscreenError } =
    useFocusSpace();
  const isRailSuppressed = isFocusSpace || readerChrome.navigation === "hidden";

  useEffect(() => {
    if (!isRailSuppressed) setIsRailOverlayOpen(false);
  }, [isRailSuppressed]);

  const {
    settings,
    loading: settingsLoading,
    update: updateSettings,
    refreshInfo: refreshSettingsInfo,
  } = useSettings();
  const initializedFromSettingsRef = useRef(false);
  const initialHashActivityRef = useRef<WorkspaceActivityId | null>(
    typeof window !== "undefined" ? activityFromHash(window.location.hash) : null
  );

  // Keep the URL hash in sync without adding a history entry or re-triggering
  // the hashchange listener. An explicit hash still wins on startup.
  const syncHash = useCallback((activity: WorkspaceActivityId) => {
    if (typeof window === "undefined") return;
    const nextHash = hashForActivity(activity);
    if (window.location.hash !== nextHash) {
      window.history.replaceState(window.history.state, "", nextHash);
    }
  }, []);

  // A workspace change dismisses transient drawers so two right-edge surfaces
  // (context panel and reader drawer) can never occupy the same space. Stale
  // deep-link targets and intents for abandoned workspaces are cleared only
  // when leaving their owning workspace.
  const selectActivity = useCallback((activity: WorkspaceActivityId) => {
    setIsPanelOpen(false);
    if (activity !== "reader") setReaderTarget(null);
    if (activity !== "knowledge-desk") setSelectedDeskRecordId(null);
    setIntentQueue((current) => pruneIntentsForActivity(current, activity));
    setActiveActivity(activity);
    syncHash(activity);
  }, [syncHash]);

  useEffect(() => {
    const onHashChange = () => {
      const activity = activityFromHash(window.location.hash);
      if (activity) selectActivity(activity);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [selectActivity]);

  const requestIntent = useCallback(
    (request: WorkspaceIntentRequest) => {
      intentSequenceRef.current += 1;
      const activity = intentTargetActivity(request, activeActivity);
      const intent = createWorkspaceIntent(
        request,
        `dace-intent-${intentSequenceRef.current}`,
        activity
      );
      if (activity) selectActivity(activity);
      setIntentQueue((current) => enqueueWorkspaceIntent(current, intent));
    },
    [activeActivity, selectActivity]
  );

  const consumeIntent = useCallback((intentId: string) => {
    if (consumedIntentIdsRef.current.has(intentId)) return;
    consumedIntentIdsRef.current.add(intentId);
    setIntentQueue((current) => consumeWorkspaceIntent(current, intentId));
  }, []);

  const handleReaderChromeChange = useCallback((chrome: ReaderChromeState) => {
    setReaderChrome(chrome);
  }, []);

  useEffect(() => {
    if (activeActivity !== "reader") {
      setReaderChrome({ navigation: "full", header: "full" });
    }
  }, [activeActivity]);

  // Apply the persisted startup workspace once preferences have loaded, unless
  // the URL explicitly named an activity. The hash is the user's direct intent.
  useEffect(() => {
    if (settingsLoading || initializedFromSettingsRef.current) return;
    initializedFromSettingsRef.current = true;
    if (initialHashActivityRef.current) return;
    const initial =
      settings.general.startupBehavior === "remember-last"
        ? settings.general.lastActiveActivity
        : settings.general.defaultActivity;
    if (!isWorkspaceActivity(initial)) return;
    setActiveActivity(initial);
    syncHash(initial);
  }, [
    settingsLoading,
    settings.general.defaultActivity,
    settings.general.lastActiveActivity,
    settings.general.startupBehavior,
    syncHash,
  ]);

  // Keep the last workspace current without writing on every transient view.
  useEffect(() => {
    if (!initializedFromSettingsRef.current) return;
    if (settings.general.startupBehavior !== "remember-last") return;
    if (!isPersistableActivity(activeActivity)) return;
    if (settings.general.lastActiveActivity === activeActivity) return;
    void updateSettings((current) => ({
      ...current,
      general: { ...current.general, lastActiveActivity: activeActivity },
    }));
  }, [activeActivity, settings.general.lastActiveActivity, settings.general.startupBehavior, updateSettings]);

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

  // One quiet update check per launch; failures (offline, no release yet,
  // unsigned dev build) stay silent — Settings › About reports details.
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const available = await checkForUpdate();
        if (!cancelled && available) {
          showNotice(`Dace ${available.version} is available — install it from Settings › About`, 9000);
        }
      } catch {
        // Silent by design.
      }
    }, 8000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [showNotice]);

  const finishSaveAndClose = useCallback(async () => {
    const result = await attemptClose(saveRegistryRef.current, {
      isClosing: () => isClosingRef.current,
      beginClosing: () => {
        isClosingRef.current = true;
      },
      cancelClosing: () => {
        isClosingRef.current = false;
      },
      close: async () => {
        setCloseError(null);
        await closeNativeWindow();
      },
    });
    if (!result.canClose && !result.duplicate) {
      setCloseError(result.errors.join(" ") || "A required save failed before Dace could close");
    }
  }, []);

  const discardAndClose = useCallback(async () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    setCloseError(null);
    await closeNativeWindow();
  }, []);

  // Single owner for Tauri close requests. onCloseRequested destroys the window
  // automatically unless preventDefault() is called, so any pending save must
  // prevent first and then close explicitly once its flush succeeds.
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;

    async function initCloseHandler() {
      try {
        const stopListening = await getCurrentWindow().onCloseRequested(async (event) => {
          if (isClosingRef.current) {
            event.preventDefault();
            return;
          }
          const registry = saveRegistryRef.current;
          if (!registry.isDirty() && !registry.isSaving()) return;
          event.preventDefault();
          await finishSaveAndClose();
        });
        if (disposed) {
          stopListening();
          return;
        }
        unlisten = stopListening;
      } catch (err) {
        console.error("[WorkspaceShell] Failed to register onCloseRequested handler:", err);
      }
    }

    void initCloseHandler();
    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
    };
  }, [finishSaveAndClose]);

  const handleExportBackup = useCallback(async () => {
    if (isBackupRunning) {
      showNotice("A backup export is already in progress.", 2500);
      return;
    }
    setIsBackupRunning(true);
    showNotice("Preparing backup export…", 0);
    try {
      const result = await exportBackup(
        (progress) => {
          showNotice(progress.message || "Exporting backup…", 0);
        },
        settings.documents.defaultBackupDirectory
      );
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
      void refreshSettingsInfo();
    }
  }, [isBackupRunning, settings.documents.defaultBackupDirectory, showNotice, refreshSettingsInfo]);

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
      const preview = await inspectBackupArchive((progress) => {
        showNotice(inspectionProgressMessage(progress), 0);
      });
      setRestorePreview(preview);
      showNotice(inspectionSuccessMessage(preview.archive_path), 5000);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Could not validate backup.";
      if (/cancelled/i.test(msg)) {
        showNotice("Restore cancelled.", 3000);
      } else {
        showNotice(`Restore validation failed: ${msg}`, 10000);
      }
    } finally {
      setIsRestoreInspecting(false);
      void refreshSettingsInfo();
    }
  }, [isBackupRunning, isRestoreInspecting, isRestoreRunning, showNotice, refreshSettingsInfo]);

  useEffect(() => {
    const shellIntent = intentQueue.find(isShellIntent);
    if (!shellIntent || consumedIntentIdsRef.current.has(shellIntent.id)) return;
    consumeIntent(shellIntent.id);
    if (shellIntent.type === "export-backup") void handleExportBackup();
    if (shellIntent.type === "restore-backup") void handleRestoreBackup();
  }, [intentQueue, consumeIntent, handleExportBackup, handleRestoreBackup]);

  const confirmRestore = useCallback(async () => {
    if (!restorePreview || isRestoreRunning) return;
    setIsRestoreRunning(true);
    setRestoreError(null);
    setRestoreProgress("Preparing restore…");
    showNotice("Preparing restore…", 0);
    try {
      const staged = await restoreBackupArchive(
        restorePreview.archive_path,
        restorePreview.archive_size,
        restorePreview.archive_sha256,
        (progress) => {
          const message = progress.message || "Preparing restore…";
          setRestoreProgress(message);
          showNotice(message, 0);
        }
      );
      const stagedMessage = restoreStagedMessage(staged.restart_required);
      setRestoreProgress(stagedMessage);
      showNotice(stagedMessage, 0);
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
        showNotice(restoreOutcomeNotice(outcome), outcome.success ? 10000 : 16000);
      } catch {
        // Ignore unavailable result state outside the desktop shell.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showNotice]);

  const closeOverlay = useCallback(() => setActiveOverlay(null), []);
  const openOverlay = useCallback((overlay: OverlayType) => setActiveOverlay(overlay), []);

  const toggleRail = useCallback(() => {
    if (isRailSuppressed) {
      setIsRailOverlayOpen((prev) => !prev);
      return;
    }
    setIsRailCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("dace_nav_collapsed", String(next));
      } catch {}
      return next;
    });
  }, [isRailSuppressed]);

  const toggleColorMode = useCallback(() => {
    const nextMode = settings.appearance.colorMode === "dark" ? "light" : "dark";
    void updateSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, colorMode: nextMode },
    }));
    showNotice(nextMode === "dark" ? "Switched to Dark Mode" : "Switched to Light Mode");
  }, [settings.appearance.colorMode, updateSettings, showNotice]);

  const commandList = useMemo(() => {
    return buildCommandList({
      activeActivity,
      setActiveActivity: selectActivity,
      requestIntent,
      onToggleNav: toggleRail,
      colorMode: settings.appearance.colorMode,
      onToggleColorMode: toggleColorMode,
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
    requestIntent,
    toggleRail,
    settings.appearance.colorMode,
    toggleColorMode,
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
    requestIntent,
    onToggleNav: toggleRail,
    onToggleColorMode: toggleColorMode,
    onToggleAssistant: toggleAssistant,
  });

  const deskIntent = intentQueue.find(isTargetedKnowledgeDeskIntent) ?? null;
  const readerIntent = intentQueue.find(isTargetedResearchReaderIntent) ?? null;

  const isRailVisible = !isFocusSpace && readerChrome.navigation !== "hidden" && !isRailCollapsed;

  return (
    <div
      className={`dace-app reader-nav-${readerChrome.navigation} reader-header-${readerChrome.header} ${
        isRailVisible ? "rail-visible" : "rail-hidden"
      }`}
    >
      <WorkspaceTopBar
        activeActivity={activeActivity}
        isFocusSpace={isFocusSpace}
        hidden={readerChrome.header === "hidden"}
        colorMode={settings.appearance.colorMode}
        onToggleColorMode={toggleColorMode}
        onOpenCommands={() => openOverlay("command-palette")}
        onOpenShortcuts={() => openOverlay("shortcut-reference")}
        onSearch={() => requestIntent({ type: "search-records" })}
        commandsTriggerRef={commandsTriggerRef}
        shortcutsTriggerRef={shortcutsTriggerRef}
        isAssistantOpen={isAssistantOpen}
        onToggleAssistant={toggleAssistant}
      />

      <WindowControls isFocusSpace={isFocusSpace} />

      <div className="workspace-shell-body">
        <WorkspaceRail
          activeActivity={activeActivity}
          isFocusSpace={isFocusSpace}
          onSelectActivity={selectActivity}
          onTogglePanel={() => setIsPanelOpen((current) => !current)}
          isPanelOpen={isPanelOpen}
          panelTriggerRef={panelTriggerRef}
          hidden={readerChrome.navigation === "hidden"}
          compact={readerChrome.navigation === "compact" || settings.appearance.sidebarCollapsed}
          isCollapsed={isRailOverlayOpen ? false : isRailCollapsed}
          onToggleCollapse={toggleRail}
          isOverlayOpen={isRailOverlayOpen}
        />

        <main className={`workspace-stage ${isFocusSpace ? "focus-active" : ""}`}>
        <FocusSpaceView
          onOpenCommands={() => openOverlay("command-palette")}
          onToggleRail={toggleRail}
          isRailOpen={isRailOverlayOpen}
        >
          <div className="central-workspace">
              {activeActivity === "workspace" && (
                <WorkspaceErrorBoundary workspace="Workspace Home">
                <WorkspaceIntro
                  onOpenCommands={() => openOverlay("command-palette")}
                  onOpenShortcuts={() => openOverlay("shortcut-reference")}
                  onEnterFocus={() => enterFocusSpace()}
                  onOpenKnowledgeDesk={() => selectActivity("knowledge-desk")}
                  onNewRecord={() => requestIntent({ type: "new-record" })}
                  onOpenReader={() => selectActivity("reader")}
                  onOpenGraph={() => selectActivity("knowledge-graph")}
                  onOpenRecord={(recordId) => {
                    setSelectedDeskRecordId(recordId);
                    selectActivity("knowledge-desk");
                  }}
                  onExportBackup={handleExportBackup}
                  onRestoreBackup={handleRestoreBackup}
                />
                </WorkspaceErrorBoundary>
              )}

              {activeActivity === "knowledge-desk" && (
                <WorkspaceErrorBoundary workspace="Knowledge Desk">
                <KnowledgeDesk
                  onShowNotice={showNotice}
                  initialRecordId={selectedDeskRecordId}
                  intent={deskIntent}
                  onConsumeIntent={consumeIntent}
                  saveRegistry={saveRegistryRef.current}
                  onOpenInReader={(attId, pageNum) => {
                    setReaderTarget({ attachmentId: attId, pageNumber: pageNum });
                    selectActivity("reader");
                  }}
                  onOpenGraphView={() => selectActivity("knowledge-graph")}
                  onRecordDeleted={(recordId) =>
                    setSelectedDeskRecordId((current) => (current === recordId ? null : current))
                  }
                />
                </WorkspaceErrorBoundary>
              )}

              {activeActivity === "reader" && (
                <WorkspaceErrorBoundary workspace="Research Reader">
                <ResearchReaderView
                  initialAttachmentId={readerTarget?.attachmentId}
                  initialPage={readerTarget?.pageNumber}
                  intent={readerIntent}
                  onConsumeIntent={consumeIntent}
                  saveRegistry={saveRegistryRef.current}
                  onNavigateToRecord={(recordId) => {
                    setSelectedDeskRecordId(recordId);
                    selectActivity("knowledge-desk");
                  }}
                  onShowNotice={showNotice}
                  isFocusSpace={isFocusSpace}
                  onToggleFocus={() => void toggleFocusSpace()}
                  onChromeChange={handleReaderChromeChange}
                />
                </WorkspaceErrorBoundary>
              )}

              {activeActivity === "knowledge-graph" && (
                <WorkspaceErrorBoundary workspace="Knowledge Graph">
                <KnowledgeGraphView
                  onOpenRecordInDesk={(recordId) => {
                    setSelectedDeskRecordId(recordId);
                    selectActivity("knowledge-desk");
                  }}
                  onShowNotice={showNotice}
                />
                </WorkspaceErrorBoundary>
              )}

              {activeActivity === "settings" && (
                <WorkspaceErrorBoundary workspace="Settings">
                <SettingsView
                  onExportBackup={() => void handleExportBackup()}
                  onRestoreBackup={() => void handleRestoreBackup()}
                />
                </WorkspaceErrorBoundary>
              )}

              {activeActivity === "terminal" && (
                <WorkspaceErrorBoundary workspace="Terminal">
                  <TerminalView onNotice={showNotice} />
                </WorkspaceErrorBoundary>
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
                <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--font-label)" }}>
                  Current Activity
                </div>
                <div style={{ fontWeight: 600, color: "var(--text-primary)", marginTop: "4px" }}>
                  {activeActivity === "workspace"
                    ? "Workspace Home"
                    : activeActivity === "knowledge-desk"
                    ? "Knowledge Desk"
                    : activeActivity === "knowledge-graph"
                    ? "Knowledge Graph"
                    : activeActivity === "reader"
                    ? "Research Reader"
                    : activeActivity === "terminal"
                    ? "Terminal"
                    : "Settings"}
                </div>
              </div>

              <div>
                <div style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--font-label)" }}>
                  Focus Space
                </div>
                <div style={{ color: "var(--text-secondary)", marginTop: "4px" }}>
                  {isFocusSpace ? "Active (Distraction-Free)" : "Standard Windowed Mode"}
                </div>
              </div>

              <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border-subtle)", fontSize: "var(--font-size-xs)", color: "var(--text-muted)", lineHeight: "1.5", fontFamily: "var(--font-label)" }}>
                Panels in Dace only consume screen space when summoned. Dismiss with <kbd>Esc</kbd> or the close control.
              </div>
            </div>
        </ContextualPanel>
      </main>
        <AssistantPanel
          open={isAssistantOpen && !isFocusSpace}
          suspended={activeOverlay !== null || closeError !== null}
          onClose={() => setIsAssistantOpen(false)}
          onShowNotice={showNotice}
        />
      </div>

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

      {closeError && (
        <div
          className="overlay-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Unsaved Changes on Close"
        >
          <div ref={closeErrorDialogRef} className="delete-confirm-dialog">
            <h3 className="confirm-title">Unsaved Changes</h3>
            <p className="confirm-message">
              {closeError}
              <br />
              Closing now will cause recent changes to be lost. What would you like to do?
            </p>
            <div className="confirm-actions">
              <button type="button" className="desk-btn" onClick={() => setCloseError(null)}>
                Keep Editing
              </button>
              <button type="button" className="desk-btn danger" onClick={() => void discardAndClose()}>
                Discard & Close
              </button>
              <button
                type="button"
                className="desk-btn primary"
                onClick={() => void finishSaveAndClose()}
              >
                Retry Save & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {(notice || fullscreenError) && (
        <div className="quiet-notice" role="status">
          {fullscreenError ? `Note: ${fullscreenError}` : notice}
        </div>
      )}
    </div>
  );
};
