import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatBytes } from "../backup/backupApi";
import { useSettings } from "./SettingsContext";
import { listSystemFonts } from "./fontsApi";
import type { SystemFont } from "./fonts";
import { pickBackupDirectory } from "./settingsApi";
import { isTauriEnvironment } from "../focus/tauriWindow.ts";
import { getVaultInfo, pickVaultFolder, restartApp, setVaultLocation, type VaultInfo } from "./vaultApi";
import {
  checkForUpdate,
  describeUpdateError,
  installUpdateAndRestart,
  type AvailableUpdate,
} from "./updaterApi";
import type {
  AppSettings,
  ColorMode,
  DefaultActivity,
  Density,
  EditorFormat,
  ReaderModeSetting,
  SettingsSectionId,
  StartupBehavior,
} from "./types";

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; update: AvailableUpdate }
  | { kind: "installing"; percent: number | null }
  | { kind: "error"; message: string };

/** Check, download and install signed updates without leaving Settings. */
function UpdatePanel({ isDesktop }: { isDesktop: boolean }) {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });

  const runCheck = async () => {
    setState({ kind: "checking" });
    try {
      const appUpdate = await checkForUpdate();
      setState(appUpdate ? { kind: "available", update: appUpdate } : { kind: "current" });
    } catch (err) {
      setState({ kind: "error", message: describeUpdateError(err) });
    }
  };

  const runInstall = async () => {
    setState({ kind: "installing", percent: null });
    try {
      await installUpdateAndRestart(({ downloaded, total }) => {
        setState({ kind: "installing", percent: total ? Math.round((downloaded / total) * 100) : null });
      });
    } catch (err) {
      setState({ kind: "error", message: describeUpdateError(err) });
    }
  };

  const status =
    !isDesktop
      ? "Updates are available in the desktop app."
      : state.kind === "checking"
        ? "Checking…"
        : state.kind === "current"
          ? "You're on the latest version."
          : state.kind === "available"
            ? `Version ${state.update.version} is available.`
            : state.kind === "installing"
              ? state.percent === null
                ? "Downloading…"
                : `Downloading… ${state.percent}%`
              : state.kind === "error"
                ? state.message
                : "Dace checks GitHub Releases for signed updates.";

  return (
    <div className="settings-update">
      <div className="settings-readout">
        <span>Updates</span>
        <strong aria-live="polite">{status}</strong>
      </div>
      {state.kind === "available" && state.update.notes && (
        <p className="settings-note settings-update-notes">{state.update.notes}</p>
      )}
      {isDesktop && (
        <div className="settings-action-row">
          {state.kind === "available" ? (
            <button type="button" className="settings-primary" onClick={() => void runInstall()}>
              Install {state.update.version} and restart
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void runCheck()}
              disabled={state.kind === "checking" || state.kind === "installing"}
            >
              Check for updates
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Choose where documents and readable note files live. */
function VaultPanel() {
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const isDesktop = isTauriEnvironment();

  const refresh = useCallback(async () => {
    try {
      setInfo(await getVaultInfo());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const apply = async (path: string | null) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await setVaultLocation(path);
      await refresh();
      const parts = [
        path ? `Vault set. ${result.notesWritten} notes written as Markdown files.` : "Documents will be kept in Dace's own folder again.",
        result.documentsCopied > 0 ? `${result.documentsCopied} documents copied.` : "",
        result.restartRequired ? `Your previous copy is untouched at ${result.previousDocumentsDir}.` : "",
      ];
      setMessage(parts.filter(Boolean).join(" "));
      setNeedsRestart(result.restartRequired);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    const picked = await pickVaultFolder(info?.path ?? null);
    if (picked) await apply(picked);
  };

  if (!isDesktop) {
    return (
      <div className="settings-readout settings-vault">
        <span>Vault folder</span>
        <strong>Available in the desktop app.</strong>
      </div>
    );
  }

  return (
    <div className="settings-vault">
      <div className="settings-readout">
        <span>Vault folder</span>
        <strong>{info?.path ?? "Dace's own folder (default)"}</strong>
      </div>
      <p className="settings-note">
        Imported documents are kept in <code>Documents</code> and every note is also saved as a readable
        Markdown file in <code>Notes</code>. Pick a synced folder (OneDrive, Dropbox) to keep copies elsewhere.
      </p>
      {info && (
        <p className="settings-note settings-vault-paths">
          Documents: {info.documentsDir}
          {info.notesDir ? <><br />Notes: {info.notesDir}</> : null}
        </p>
      )}
      <div className="settings-action-row">
        <button type="button" className="settings-primary" onClick={() => void choose()} disabled={busy}>
          {busy ? "Working…" : info?.path ? "Change vault folder…" : "Choose vault folder…"}
        </button>
        {info?.path && (
          <button type="button" onClick={() => void apply(null)} disabled={busy}>
            Use Dace's own folder
          </button>
        )}
        {needsRestart && (
          <button type="button" onClick={() => void restartApp()}>
            Restart Dace now
          </button>
        )}
      </div>
      {message && (
        <p className="settings-note" role="status">
          {message}
          {needsRestart ? " Restart Dace to finish switching." : ""}
        </p>
      )}
    </div>
  );
}

interface SettingsViewProps {
  onExportBackup: () => void;
  onRestoreBackup: () => void;
}

const SECTIONS: Array<{ id: SettingsSectionId; label: string; hint: string }> = [
  { id: "general", label: "General", hint: "Startup and confirmation" },
  { id: "appearance", label: "Appearance", hint: "Density and accessibility" },
  { id: "workspace", label: "Workspace", hint: "Navigation and reader" },
  { id: "editor", label: "Editor", hint: "Writing behaviour" },
  { id: "storage", label: "Documents & storage", hint: "Local data information" },
  { id: "backup", label: "Backup & recovery", hint: "Archives and restore" },
  { id: "about", label: "About", hint: "Version and platform" },
];

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <label className="settings-field">
      <span className="settings-field-copy">
        <span className="settings-field-label">{label}</span>
        {description && <span className="settings-field-description">{description}</span>}
      </span>
      <span className="settings-field-control">{children}</span>
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`settings-toggle ${checked ? "is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function useSystemFonts() {
  const [fonts, setFonts] = useState<SystemFont[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let active = true;
    void listSystemFonts().then((list) => {
      if (!active) return;
      setFonts(list);
      setUsingFallback(list.every((font) => font.source === "browser-preview"));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { fonts, loading, usingFallback };
}

export function SettingsView({ onExportBackup, onRestoreBackup }: SettingsViewProps) {
  const {
    settings,
    storageInfo,
    appInfo,
    loading,
    saving,
    error,
    savedAt,
    update,
    reset,
    refreshInfo,
  } = useSettings();
  const [section, setSection] = useState<SettingsSectionId>("general");
  const { fonts, loading: loadingFonts, usingFallback } = useSystemFonts();

  const fontOptions = useMemo(() => {
    const families = new Set<string>();
    for (const font of fonts) families.add(font.family);
    families.add(settings.appearance.appFont);
    families.add(settings.appearance.textFont);
    return [...families].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [fonts, settings.appearance.appFont, settings.appearance.textFont]);

  const patch = useCallback(
    (build: (current: AppSettings) => AppSettings) => {
      void update(build);
    },
    [update]
  );

  const handleReset = () => {
    if (
      settings.general.confirmDestructiveActions &&
      !window.confirm("Reset all Dace preferences to their defaults?")
    ) {
      return;
    }
    void reset();
  };

  const handleChooseBackupDirectory = useCallback(async () => {
    try {
      const chosen = await pickBackupDirectory(settings.documents.defaultBackupDirectory);
      if (!chosen) return;
      patch((current) => ({
        ...current,
        documents: { ...current.documents, defaultBackupDirectory: chosen },
      }));
    } catch (err) {
      const message = typeof err === "string" ? err : err instanceof Error ? err.message : "Could not choose folder.";
      window.alert(message);
    }
  }, [patch, settings.documents.defaultBackupDirectory]);

  const renderSection = () => {
    switch (section) {
      case "general":
        return (
          <>
            <Field
              label="Startup behaviour"
              description="Choose what Dace opens when it launches."
            >
              <select
                value={settings.general.startupBehavior}
                onChange={(event) =>
                  patch((current) => ({
                    ...current,
                    general: {
                      ...current.general,
                      startupBehavior: event.target.value as StartupBehavior,
                    },
                  }))
                }
              >
                <option value="remember-last">Reopen last workspace</option>
                <option value="default-activity">Always open default workspace</option>
              </select>
            </Field>
            <Field
              label="Default workspace"
              description="Used when Dace is configured to open a fixed workspace."
            >
              <select
                value={settings.general.defaultActivity}
                onChange={(event) =>
                  patch((current) => ({
                    ...current,
                    general: {
                      ...current.general,
                      defaultActivity: event.target.value as DefaultActivity,
                    },
                  }))
                }
              >
                <option value="workspace">Workspace</option>
                <option value="knowledge-desk">Knowledge Desk</option>
                <option value="reader">Research Reader</option>
                <option value="knowledge-graph">Knowledge Graph</option>
              </select>
            </Field>
            <Field
              label="Confirm destructive actions"
              description="Ask before resetting preferences or replacing library data."
            >
              <Toggle
                label="Confirm destructive actions"
                checked={settings.general.confirmDestructiveActions}
                onChange={(checked) =>
                  patch((current) => ({
                    ...current,
                    general: { ...current.general, confirmDestructiveActions: checked },
                  }))
                }
              />
            </Field>
            <div className="settings-readout">
              <span>Last active workspace</span>
              <strong>{settings.general.lastActiveActivity}</strong>
            </div>
          </>
        );

      case "appearance":
        return (
          <>
            <Field label="Colour mode" description="Toggle between warm paper light and obsidian dark (Ctrl+Shift+L).">
              <div className="settings-segmented">
                {(["light", "dark"] as ColorMode[]).map((colorMode) => (
                  <button
                    key={colorMode}
                    type="button"
                    className={settings.appearance.colorMode === colorMode ? "is-active" : ""}
                    onClick={() =>
                      patch((current) => ({
                        ...current,
                        appearance: { ...current.appearance, colorMode },
                      }))
                    }
                  >
                    {colorMode}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Interface density" description="Controls chrome spacing across workspaces.">
              <div className="settings-segmented">
                {(["comfortable", "compact"] as Density[]).map((density) => (
                  <button
                    key={density}
                    type="button"
                    className={settings.appearance.density === density ? "is-active" : ""}
                    onClick={() =>
                      patch((current) => ({
                        ...current,
                        appearance: { ...current.appearance, density },
                      }))
                    }
                  >
                    {density}
                  </button>
                ))}
              </div>
            </Field>
            <Field
              label={`Text scaling — ${settings.appearance.textScale.toFixed(2)}×`}
              description="Scales interface typography without changing the design system."
            >
              <input
                type="range"
                min={0.85}
                max={1.25}
                step={0.05}
                value={settings.appearance.textScale}
                onChange={(event) =>
                  patch((current) => ({
                    ...current,
                    appearance: {
                      ...current.appearance,
                      textScale: Number(event.target.value),
                    },
                  }))
                }
              />
            </Field>
            <Field
              label="App font"
              description="Installed fonts for the interface; monospace choices also style the terminal."
            >
              <select
                aria-label="App font"
                value={settings.appearance.appFont}
                disabled={loadingFonts}
                onChange={(event) =>
                  patch((current) => ({
                    ...current,
                    appearance: {
                      ...current.appearance,
                      appFont: event.target.value,
                    },
                  }))
                }
              >
                {fontOptions.map((family) => (
                  <option key={family} value={family}>
                    {family}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Text font"
              description="Fonts installed on this device, used for long-form reading."
            >
              <select
                aria-label="Text font"
                value={settings.appearance.textFont}
                disabled={loadingFonts}
                onChange={(event) =>
                  patch((current) => ({
                    ...current,
                    appearance: {
                      ...current.appearance,
                      textFont: event.target.value,
                    },
                  }))
                }
              >
                {fontOptions.map((family) => (
                  <option key={family} value={family}>
                    {family}
                  </option>
                ))}
              </select>
            </Field>
            {usingFallback && (
              <p className="settings-font-notice">
                Installed fonts are listed in the desktop app. The browser preview shows a short
                fallback list.
              </p>
            )}
            <Field label="Reduced motion" description="Minimise decorative animation and transitions.">
              <Toggle
                label="Reduced motion"
                checked={settings.appearance.reducedMotion}
                onChange={(checked) =>
                  patch((current) => ({
                    ...current,
                    appearance: { ...current.appearance, reducedMotion: checked },
                  }))
                }
              />
            </Field>
            <Field label="Collapsed sidebar" description="Start with the workspace rail compacted.">
              <Toggle
                label="Collapsed sidebar"
                checked={settings.appearance.sidebarCollapsed}
                onChange={(checked) =>
                  patch((current) => ({
                    ...current,
                    appearance: { ...current.appearance, sidebarCollapsed: checked },
                  }))
                }
              />
            </Field>
          </>
        );

      case "workspace":
        return (
          <>
            <Field label="Reader default layout">
              <select
                value={settings.workspace.readerDefaultMode}
                onChange={(event) =>
                  patch((current) => ({
                    ...current,
                    workspace: {
                      ...current.workspace,
                      readerDefaultMode: event.target.value as ReaderModeSetting,
                    },
                  }))
                }
              >
                <option value="reading">Reading</option>
                <option value="research">Research</option>
                <option value="writing">Writing</option>
              </select>
            </Field>
            <Field
              label={`Reader split ratio — ${Math.round(settings.workspace.readerSplitRatio * 100)}%`}
              description="Persisted proportion for the research split view."
            >
              <input
                type="range"
                min={0.32}
                max={0.76}
                step={0.01}
                value={settings.workspace.readerSplitRatio}
                onChange={(event) =>
                  patch((current) => ({
                    ...current,
                    workspace: {
                      ...current.workspace,
                      readerSplitRatio: Number(event.target.value),
                    },
                  }))
                }
              />
            </Field>
            <Field label="Compact reader navigation">
              <Toggle
                label="Compact reader navigation"
                checked={settings.workspace.readerNavCollapsed}
                onChange={(checked) =>
                  patch((current) => ({
                    ...current,
                    workspace: { ...current.workspace, readerNavCollapsed: checked },
                  }))
                }
              />
            </Field>
            <Field label="Hide reader header">
              <Toggle
                label="Hide reader header"
                checked={settings.workspace.readerHeaderCollapsed}
                onChange={(checked) =>
                  patch((current) => ({
                    ...current,
                    workspace: { ...current.workspace, readerHeaderCollapsed: checked },
                  }))
                }
              />
            </Field>
          </>
        );

      case "editor":
        return (
          <>
            <Field label="Default editor format">
              <select
                value={settings.editor.defaultFormat}
                onChange={(event) =>
                  patch((current) => ({
                    ...current,
                    editor: {
                      ...current.editor,
                      defaultFormat: event.target.value as EditorFormat,
                    },
                  }))
                }
              >
                <option value="markdown">Markdown-style plain text</option>
                <option value="plain-text">Plain text</option>
              </select>
            </Field>
            <Field
              label={`Autosave delay — ${settings.editor.autosaveDelayMs} ms`}
              description="Time between the last edit and a database write."
            >
              <input
                type="range"
                min={300}
                max={5000}
                step={100}
                value={settings.editor.autosaveDelayMs}
                onChange={(event) =>
                  patch((current) => ({
                    ...current,
                    editor: {
                      ...current.editor,
                      autosaveDelayMs: Number(event.target.value),
                    },
                  }))
                }
              />
            </Field>
            <Field label="Show word count">
              <Toggle
                label="Show word count"
                checked={settings.editor.showWordCount}
                onChange={(checked) =>
                  patch((current) => ({
                    ...current,
                    editor: { ...current.editor, showWordCount: checked },
                  }))
                }
              />
            </Field>
            <Field label="Browser spellcheck">
              <Toggle
                label="Browser spellcheck"
                checked={settings.editor.spellcheck}
                onChange={(checked) =>
                  patch((current) => ({
                    ...current,
                    editor: { ...current.editor, spellcheck: checked },
                  }))
                }
              />
            </Field>
          </>
        );

      case "storage":
        return (
          <div className="settings-info-grid">
            <div className="settings-readout">
              <span>Application data</span>
              <strong>{storageInfo?.appDataDir ?? "Loading…"}</strong>
            </div>
            <div className="settings-readout">
              <span>Database</span>
              <strong>{storageInfo?.databasePath ?? "Not available"}</strong>
            </div>
            <div className="settings-readout">
              <span>Database size</span>
              <strong>{formatBytes(storageInfo?.databaseBytes ?? 0)}</strong>
            </div>
            <div className="settings-readout">
              <span>Managed attachments</span>
              <strong>
                {storageInfo?.attachmentCount ?? 0} files · {formatBytes(storageInfo?.attachmentBytes ?? 0)}
              </strong>
            </div>
            <VaultPanel />
            <div className="settings-readout">
              <span>Schema / search</span>
              <strong>
                v{storageInfo?.schemaVersion ?? 0} · FTS5 {storageInfo?.fts5Available ? "available" : "fallback"}
              </strong>
            </div>
            <Field label="Default backup folder" description="Used as the starting location for exports.">
              <div className="settings-inline-control">
                <input
                  readOnly
                  value={settings.documents.defaultBackupDirectory ?? "System file dialog"}
                  aria-label="Default backup folder"
                />
                <button type="button" onClick={() => void handleChooseBackupDirectory()}>
                  Choose
                </button>
              </div>
            </Field>
            <Field label="Open documents after import">
              <Toggle
                label="Open documents after import"
                checked={settings.documents.openImportedDocuments}
                onChange={(checked) =>
                  patch((current) => ({
                    ...current,
                    documents: { ...current.documents, openImportedDocuments: checked },
                  }))
                }
              />
            </Field>
          </div>
        );

      case "backup":
        return (
          <>
            <div className="settings-action-row">
              <button type="button" className="settings-primary" onClick={onExportBackup}>
                Create backup
              </button>
              <button type="button" onClick={onRestoreBackup}>
                Restore from archive
              </button>
            </div>
            <div className="settings-readout">
              <span>Recovery status</span>
              <strong>
                {storageInfo?.pendingRestore
                  ? "Restore pending — restart required"
                  : "No pending restore"}
              </strong>
            </div>
            {storageInfo?.lastRestoreMessage && (
              <div className="settings-readout">
                <span>Last restore result</span>
                <strong>{storageInfo.lastRestoreMessage}</strong>
              </div>
            )}
            <p className="settings-note">
              Archives are validated with SHA-256, staged before installation, and protected by a
              recovery snapshot. These checks cannot be disabled from Settings.
            </p>
          </>
        );

      case "about":
        return (
          <div className="settings-info-grid">
            <div className="settings-readout"><span>Application</span><strong>{appInfo?.name ?? "Dace"}</strong></div>
            <div className="settings-readout"><span>Version</span><strong>{appInfo?.version ?? "0.1.0"}</strong></div>
            <div className="settings-readout"><span>Tauri runtime</span><strong>{appInfo?.tauriVersion ?? "browser preview"}</strong></div>
            <div className="settings-readout"><span>Platform</span><strong>{appInfo?.platform ?? "unknown"}</strong></div>
            <div className="settings-readout"><span>Architecture</span><strong>{appInfo?.architecture ?? "unknown"}</strong></div>
            <div className="settings-readout"><span>Build</span><strong>{appInfo?.buildMode ?? "unknown"}</strong></div>
            <UpdatePanel isDesktop={isTauriEnvironment()} />
          </div>
        );
    }
  };

  return (
    <div className="settings-view">
      <aside className="settings-nav" aria-label="Settings sections">
        <div className="settings-nav-title">Preferences</div>
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-nav-item ${section === item.id ? "is-active" : ""}`}
            onClick={() => setSection(item.id)}
            title={item.hint}
          >
            <span>{item.label}</span>
          </button>
        ))}
      </aside>

      <section className="settings-content">
        <header className="settings-header">
          <div>
            <span className="settings-eyebrow">Dace Settings</span>
            <h1>{SECTIONS.find((item) => item.id === section)?.label}</h1>
          </div>
          <div className="settings-header-actions">
            <span className="settings-save-state">
              {loading ? "Loading…" : saving ? "Saving…" : error ? "Save failed" : savedAt ? "Saved" : "Ready"}
            </span>
            {(section === "storage" || section === "backup" || section === "about") && (
              <button type="button" onClick={() => void refreshInfo()} title="Refresh storage and recovery info">
                Refresh
              </button>
            )}
            <button type="button" onClick={handleReset} disabled={loading}>
              Reset to defaults
            </button>
          </div>
        </header>
        {error && <div className="settings-error" role="alert">{error}</div>}
        <div className="settings-panel">{renderSection()}</div>
      </section>
    </div>
  );
}
