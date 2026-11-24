import type {
  AppSettings,
  DefaultActivity,
  Density,
  EditorFormat,
  ReaderModeSetting,
  StartupBehavior,
} from "./types";

export const SETTINGS_FALLBACK_KEY = "dace.settings.fallback.v1";

const STARTUP_BEHAVIORS: StartupBehavior[] = ["remember-last", "default-activity"];
const DEFAULT_ACTIVITIES: DefaultActivity[] = [
  "workspace",
  "knowledge-desk",
  "reader",
  "knowledge-graph",
];
const DENSITIES: Density[] = ["comfortable", "compact"];
const READER_MODES: ReaderModeSetting[] = ["reading", "research", "writing"];
const EDITOR_FORMATS: EditorFormat[] = ["markdown", "plain-text"];

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    startupBehavior: "remember-last",
    defaultActivity: "workspace",
    lastActiveActivity: "workspace",
    confirmDestructiveActions: true,
  },
  appearance: {
    density: "comfortable",
    textScale: 1,
    reducedMotion: false,
    sidebarCollapsed: false,
  },
  workspace: {
    readerDefaultMode: "research",
    readerSplitRatio: 0.6,
    readerNavCollapsed: false,
    readerHeaderCollapsed: false,
  },
  editor: {
    defaultFormat: "markdown",
    autosaveDelayMs: 1200,
    showWordCount: true,
    spellcheck: false,
  },
  documents: {
    defaultBackupDirectory: null,
    openImportedDocuments: true,
  },
};

export function cloneDefaultSettings(): AppSettings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as AppSettings;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampNumber(value, min, max, fallback));
}

/**
 * Rebuilds a complete settings object from unknown input. Invalid or obsolete
 * values fall back individually so one bad preference cannot discard the rest.
 */
export function normalizeSettings(input: unknown): AppSettings {
  const root = asRecord(input);
  const general = asRecord(root.general);
  const appearance = asRecord(root.appearance);
  const workspace = asRecord(root.workspace);
  const editor = asRecord(root.editor);
  const documents = asRecord(root.documents);
  const defaults = cloneDefaultSettings();

  const backupDirectory =
    typeof documents.defaultBackupDirectory === "string"
      ? documents.defaultBackupDirectory.trim()
      : "";

  return {
    general: {
      startupBehavior: pick(
        general.startupBehavior,
        STARTUP_BEHAVIORS,
        defaults.general.startupBehavior
      ),
      defaultActivity: pick(
        general.defaultActivity,
        DEFAULT_ACTIVITIES,
        defaults.general.defaultActivity
      ),
      lastActiveActivity: pick(
        general.lastActiveActivity,
        DEFAULT_ACTIVITIES,
        defaults.general.lastActiveActivity
      ),
      confirmDestructiveActions:
        typeof general.confirmDestructiveActions === "boolean"
          ? general.confirmDestructiveActions
          : defaults.general.confirmDestructiveActions,
    },
    appearance: {
      density: pick(appearance.density, DENSITIES, defaults.appearance.density),
      textScale: clampNumber(appearance.textScale, 0.85, 1.25, defaults.appearance.textScale),
      reducedMotion:
        typeof appearance.reducedMotion === "boolean"
          ? appearance.reducedMotion
          : defaults.appearance.reducedMotion,
      sidebarCollapsed:
        typeof appearance.sidebarCollapsed === "boolean"
          ? appearance.sidebarCollapsed
          : defaults.appearance.sidebarCollapsed,
    },
    workspace: {
      readerDefaultMode: pick(
        workspace.readerDefaultMode,
        READER_MODES,
        defaults.workspace.readerDefaultMode
      ),
      readerSplitRatio: clampNumber(
        workspace.readerSplitRatio,
        0.32,
        0.76,
        defaults.workspace.readerSplitRatio
      ),
      readerNavCollapsed:
        typeof workspace.readerNavCollapsed === "boolean"
          ? workspace.readerNavCollapsed
          : defaults.workspace.readerNavCollapsed,
      readerHeaderCollapsed:
        typeof workspace.readerHeaderCollapsed === "boolean"
          ? workspace.readerHeaderCollapsed
          : defaults.workspace.readerHeaderCollapsed,
    },
    editor: {
      defaultFormat: pick(editor.defaultFormat, EDITOR_FORMATS, defaults.editor.defaultFormat),
      autosaveDelayMs: editor.autosaveDelayMs === 0
        ? defaults.editor.autosaveDelayMs
        : clampInt(editor.autosaveDelayMs, 300, 5000, defaults.editor.autosaveDelayMs),
      showWordCount:
        typeof editor.showWordCount === "boolean"
          ? editor.showWordCount
          : defaults.editor.showWordCount,
      spellcheck:
        typeof editor.spellcheck === "boolean" ? editor.spellcheck : defaults.editor.spellcheck,
    },
    documents: {
      defaultBackupDirectory: backupDirectory || null,
      openImportedDocuments:
        typeof documents.openImportedDocuments === "boolean"
          ? documents.openImportedDocuments
          : defaults.documents.openImportedDocuments,
    },
  };
}

export function settingsEqual(a: AppSettings, b: AppSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
