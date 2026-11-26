use crate::db::Database;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const SETTINGS_KEY: &str = "app-settings.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StartupBehavior {
    RememberLast,
    DefaultActivity,
}

impl Default for StartupBehavior {
    fn default() -> Self {
        Self::RememberLast
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DefaultActivity {
    Workspace,
    KnowledgeDesk,
    Reader,
    KnowledgeGraph,
}

impl Default for DefaultActivity {
    fn default() -> Self {
        Self::Workspace
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Density {
    Comfortable,
    Compact,
}

impl Default for Density {
    fn default() -> Self {
        Self::Comfortable
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReaderModeSetting {
    Reading,
    Research,
    Writing,
}

impl Default for ReaderModeSetting {
    fn default() -> Self {
        Self::Research
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EditorFormat {
    Markdown,
    PlainText,
}

impl Default for EditorFormat {
    fn default() -> Self {
        Self::Markdown
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GeneralSettings {
    pub startup_behavior: StartupBehavior,
    pub default_activity: DefaultActivity,
    pub last_active_activity: DefaultActivity,
    pub confirm_destructive_actions: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            startup_behavior: StartupBehavior::default(),
            default_activity: DefaultActivity::default(),
            last_active_activity: DefaultActivity::default(),
            confirm_destructive_actions: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppearanceSettings {
    pub density: Density,
    pub text_scale: f64,
    pub reduced_motion: bool,
    pub sidebar_collapsed: bool,
    pub app_font: String,
    pub text_font: String,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            density: Density::default(),
            text_scale: 1.0,
            reduced_motion: false,
            sidebar_collapsed: false,
            app_font: "Aptos".to_string(),
            text_font: "Aptos".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WorkspaceSettings {
    pub reader_default_mode: ReaderModeSetting,
    pub reader_split_ratio: f64,
    pub reader_nav_collapsed: bool,
    pub reader_header_collapsed: bool,
}

impl Default for WorkspaceSettings {
    fn default() -> Self {
        Self {
            reader_default_mode: ReaderModeSetting::default(),
            reader_split_ratio: 0.6,
            reader_nav_collapsed: false,
            reader_header_collapsed: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EditorSettings {
    pub default_format: EditorFormat,
    pub autosave_delay_ms: u64,
    pub show_word_count: bool,
    pub spellcheck: bool,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            default_format: EditorFormat::default(),
            autosave_delay_ms: 1200,
            show_word_count: true,
            spellcheck: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DocumentsSettings {
    pub default_backup_directory: Option<String>,
    pub open_imported_documents: bool,
}

impl Default for DocumentsSettings {
    fn default() -> Self {
        Self {
            default_backup_directory: None,
            open_imported_documents: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub general: GeneralSettings,
    pub appearance: AppearanceSettings,
    pub workspace: WorkspaceSettings,
    pub editor: EditorSettings,
    pub documents: DocumentsSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            general: GeneralSettings::default(),
            appearance: AppearanceSettings::default(),
            workspace: WorkspaceSettings::default(),
            editor: EditorSettings::default(),
            documents: DocumentsSettings::default(),
        }
    }
}

impl AppSettings {
    /// Clamps numeric values and normalises optional strings without discarding
    /// unrelated valid preferences.
    pub fn normalized(mut self) -> Self {
        self.appearance.text_scale = clamp(self.appearance.text_scale, 0.85, 1.25, 1.0);
        normalize_font_family(&mut self.appearance.app_font, "Aptos");
        normalize_font_family(&mut self.appearance.text_font, "Aptos");
        self.workspace.reader_split_ratio =
            clamp(self.workspace.reader_split_ratio, 0.32, 0.76, 0.6);
        self.editor.autosave_delay_ms = clamp_u64(self.editor.autosave_delay_ms, 300, 5000, 1200);

        self.documents.default_backup_directory = self
            .documents
            .default_backup_directory
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        self
    }
}

fn clamp(value: f64, min: f64, max: f64, fallback: f64) -> f64 {
    if !value.is_finite() {
        fallback
    } else {
        value.clamp(min, max)
    }
}

fn clamp_u64(value: u64, min: u64, max: u64, fallback: u64) -> u64 {
    if value == 0 {
        fallback
    } else {
        value.clamp(min, max)
    }
}

fn normalize_font_family(value: &mut String, fallback: &str) {
    let cleaned: String = value
        .chars()
        .filter(|c| {
            !c.is_control()
                && !matches!(c, ',' | ';' | ':' | '{' | '}' | '(' | ')' | '<' | '>' | '"' | '\'' | '\\')
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    *value = if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned.chars().take(120).collect()
    };
}

pub fn load_settings(db: &Database) -> Result<AppSettings, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("Settings store unavailable: {}", e))?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![SETTINGS_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Could not read settings: {}", e))?;

    match raw {
        None => Ok(AppSettings::default()),
        Some(raw) => match serde_json::from_str::<AppSettings>(&raw) {
            Ok(settings) => Ok(settings.normalized()),
            Err(_) => Ok(AppSettings::default()),
        },
    }
}

pub fn store_settings(db: &Database, settings: &AppSettings) -> Result<(), String> {
    let normalized = settings.clone().normalized();
    let json = serde_json::to_string(&normalized)
        .map_err(|e| format!("Could not serialise settings: {}", e))?;
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("Settings store unavailable: {}", e))?;

    let current: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![SETTINGS_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Could not read settings: {}", e))?;
    if current.as_deref() == Some(json.as_str()) {
        return Ok(());
    }

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![SETTINGS_KEY, json, now],
    )
    .map_err(|e| format!("Could not save settings: {}", e))?;
    Ok(())
}

pub fn reset_settings(db: &Database) -> Result<AppSettings, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("Settings store unavailable: {}", e))?;
    conn.execute(
        "DELETE FROM app_settings WHERE key = ?1",
        params![SETTINGS_KEY],
    )
    .map_err(|e| format!("Could not reset settings: {}", e))?;
    Ok(AppSettings::default())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub app_data_dir: String,
    pub database_path: Option<String>,
    pub database_bytes: u64,
    pub attachments_dir: String,
    pub attachment_bytes: u64,
    pub attachment_count: i64,
    pub schema_version: i64,
    pub fts5_available: bool,
    pub pending_restore: bool,
    pub last_restore_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    pub platform: String,
    pub architecture: String,
    pub build_mode: String,
}

fn directory_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return total,
    };
    for entry in entries.flatten() {
        if let Ok(metadata) = entry.metadata() {
            if metadata.is_file() {
                total += metadata.len();
            } else if metadata.is_dir() {
                total += directory_size(&entry.path());
            }
        }
    }
    total
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn read_restore_message(app_data_dir: &Path) -> Option<String> {
    let raw = fs::read_to_string(app_data_dir.join(crate::backup::restore::RESTORE_RESULT_FILE)).ok()?;
    let outcome: crate::backup::restore::RestoreOutcome = serde_json::from_str(&raw).ok()?;
    Some(outcome.message)
}

#[tauri::command]
pub fn get_app_settings(db: tauri::State<'_, Database>) -> Result<AppSettings, String> {
    load_settings(&db)
}

#[tauri::command]
pub fn update_app_settings(
    settings: AppSettings,
    db: tauri::State<'_, Database>,
) -> Result<AppSettings, String> {
    let normalized = settings.normalized();
    store_settings(&db, &normalized)?;
    Ok(normalized)
}

#[tauri::command]
pub fn reset_app_settings(db: tauri::State<'_, Database>) -> Result<AppSettings, String> {
    reset_settings(&db)
}

#[tauri::command]
pub fn get_storage_info(
    app: tauri::AppHandle,
    db: tauri::State<'_, Database>,
) -> Result<StorageInfo, String> {
    use tauri::Manager;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let attachments_dir = app_data_dir.join("attachments");

    let database_path = db.path.clone();
    let database_bytes = database_path
        .as_ref()
        .and_then(|path| fs::metadata(path).ok())
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    let (schema_version, fts5_available, attachment_count) = {
        let conn = db
            .conn
            .lock()
            .map_err(|e| format!("Settings store unavailable: {}", e))?;
        let version = Database::schema_version(&conn).unwrap_or(0);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM attachments", [], |row| row.get(0))
            .unwrap_or(0);
        (version, db.has_fts5, count)
    };

    let pending_restore = app_data_dir
        .join(crate::backup::restore::RESTORE_MARKER_FILE)
        .exists();
    let last_restore_message = read_restore_message(&app_data_dir);

    Ok(StorageInfo {
        app_data_dir: path_string(&app_data_dir),
        database_path: database_path.as_ref().map(|path| path_string(path)),
        database_bytes,
        attachments_dir: path_string(&attachments_dir),
        attachment_bytes: directory_size(&attachments_dir),
        attachment_count,
        schema_version,
        fts5_available,
        pending_restore,
        last_restore_message,
    })
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Dace".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        tauri_version: tauri::VERSION.to_string(),
        platform: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        build_mode: if cfg!(debug_assertions) {
            "development".to_string()
        } else {
            "release".to_string()
        },
    }
}

#[tauri::command]
pub fn pick_backup_directory(current: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new().set_title("Choose Default Backup Folder");
    if let Some(value) = current {
        let path = PathBuf::from(value.trim());
        if path.is_dir() {
            dialog = dialog.set_directory(path);
        }
    }
    Ok(dialog
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_valid() {
        let settings = AppSettings::default().normalized();
        assert_eq!(settings.appearance.text_scale, 1.0);
        assert_eq!(settings.appearance.app_font, "Aptos");
        assert_eq!(settings.appearance.text_font, "Aptos");
        assert_eq!(settings.workspace.reader_split_ratio, 0.6);
        assert!(settings.general.confirm_destructive_actions);
    }

    #[test]
    fn normalizes_out_of_range_values() {
        let mut settings = AppSettings::default();
        settings.appearance.text_scale = 9.0;
        settings.appearance.app_font = " Segoe UI; color: red ".to_string();
        settings.appearance.text_font = "   ".to_string();
        settings.workspace.reader_split_ratio = -1.0;
        settings.editor.autosave_delay_ms = 0;
        settings.documents.default_backup_directory = Some("   ".to_string());
        let normalized = settings.normalized();
        assert_eq!(normalized.appearance.text_scale, 1.25);
        assert_eq!(normalized.appearance.app_font, "Segoe UI color red");
        assert_eq!(normalized.appearance.text_font, "Aptos");
        assert_eq!(normalized.workspace.reader_split_ratio, 0.32);
        assert_eq!(normalized.editor.autosave_delay_ms, 1200);
        assert_eq!(normalized.documents.default_backup_directory, None);
    }

    #[test]
    fn persists_and_resets_settings() {
        let db = Database::init_in_memory().expect("in-memory database");
        let mut settings = AppSettings::default();
        settings.appearance.density = Density::Compact;
        settings.appearance.app_font = "Calibri".to_string();
        settings.appearance.text_font = "Georgia".to_string();
        settings.editor.show_word_count = false;
        store_settings(&db, &settings).expect("settings should persist");
        assert_eq!(load_settings(&db).expect("settings should load"), settings);
        reset_settings(&db).expect("settings should reset");
        assert_eq!(load_settings(&db).expect("defaults should load"), AppSettings::default());
    }

    #[test]
    fn invalid_stored_json_falls_back_to_defaults() {
        let db = Database::init_in_memory().expect("in-memory database");
        {
            let conn = db.conn.lock().expect("database lock");
            conn.execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
                params![SETTINGS_KEY, "{not valid json", "now"],
            )
            .expect("invalid row should be stored");
        }
        assert_eq!(load_settings(&db).expect("defaults should load"), AppSettings::default());
    }
}
