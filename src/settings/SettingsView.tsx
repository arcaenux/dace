import { useCallback, useState, type ReactNode } from "react";
import { formatBytes } from "../backup/backupApi";
import { useSettings } from "./SettingsContext";
import { pickBackupDirectory } from "./settingsApi";
import type {
  AppSettings,
  DefaultActivity,
  Density,
  EditorFormat,
  ReaderModeSetting,
  SettingsSectionId,
  StartupBehavior,
} from "./types";

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
            <Field label="Interface density" description="Dace keeps one permanent visual identity.">
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
            <div className="settings-readout">
              <span>Attachment vault</span>
              <strong>{storageInfo?.attachmentsDir ?? "Not available"}</strong>
            </div>
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
          >
            <span>{item.label}</span>
            <small>{item.hint}</small>
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
            <button type="button" onClick={handleReset} disabled={loading}>
              Reset to defaults
            </button>
          </div>
        </header>
        {error && <div className="settings-error" role="alert">{error}</div>}
        <div className="settings-panel">{renderSection()}</div>
        <button type="button" className="settings-refresh" onClick={() => void refreshInfo()}>
          Refresh storage and recovery information
        </button>
      </section>
    </div>
  );
}
