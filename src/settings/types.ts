export type StartupBehavior = "remember-last" | "default-activity";
export type DefaultActivity = "workspace" | "knowledge-desk" | "reader" | "knowledge-graph";
export type Density = "comfortable" | "compact";
export type ReaderModeSetting = "reading" | "research" | "writing";
export type EditorFormat = "markdown" | "plain-text";

export interface GeneralSettings {
  startupBehavior: StartupBehavior;
  defaultActivity: DefaultActivity;
  lastActiveActivity: DefaultActivity;
  confirmDestructiveActions: boolean;
}

export interface AppearanceSettings {
  density: Density;
  textScale: number;
  reducedMotion: boolean;
  sidebarCollapsed: boolean;
  /** Installed font family used for the application interface. */
  appFont: string;
  /** Installed font family used for reader and editorial text. */
  textFont: string;
}

export interface WorkspaceSettings {
  readerDefaultMode: ReaderModeSetting;
  readerSplitRatio: number;
  readerNavCollapsed: boolean;
  readerHeaderCollapsed: boolean;
}

export interface EditorSettings {
  defaultFormat: EditorFormat;
  autosaveDelayMs: number;
  showWordCount: boolean;
  spellcheck: boolean;
}

export interface DocumentsSettings {
  defaultBackupDirectory: string | null;
  openImportedDocuments: boolean;
}

export interface AppSettings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  workspace: WorkspaceSettings;
  editor: EditorSettings;
  documents: DocumentsSettings;
}

export interface StorageInfo {
  appDataDir: string;
  databasePath: string | null;
  databaseBytes: number;
  attachmentsDir: string;
  attachmentBytes: number;
  attachmentCount: number;
  schemaVersion: number;
  fts5Available: boolean;
  pendingRestore: boolean;
  lastRestoreMessage: string | null;
}

export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  platform: string;
  architecture: string;
  buildMode: string;
}

export type SettingsSectionId = "general" | "appearance" | "workspace" | "editor" | "storage" | "backup" | "about";
