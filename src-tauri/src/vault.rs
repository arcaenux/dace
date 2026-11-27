//! The vault: a folder the user chooses for their library's files.
//!
//! * `<vault>/Documents/` holds every imported document (the managed,
//!   content-addressed store: integrity checks, de-duplication, backup and
//!   restore all work from here).
//! * `<vault>/Notes/` holds a readable Markdown copy of every note, kept in
//!   step with the library as notes are created, renamed, edited and deleted.
//!
//! The search index database stays in the app's own data folder. With no
//! vault chosen, documents live in `<app data>/attachments` as before.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::db::Database;
use crate::knowledge::models::KnowledgeRecord;
use crate::knowledge::repository::KnowledgeRepository;

const VAULT_CONFIG_FILE: &str = "vault.json";
const DOCUMENTS_DIR: &str = "Documents";
const NOTES_DIR: &str = "Notes";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultConfig {
    path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    /// The chosen vault folder, or None when using the app's own folder.
    pub path: Option<String>,
    pub documents_dir: String,
    pub notes_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultChangeResult {
    pub documents_copied: usize,
    pub notes_written: usize,
    /// Where the previous documents still are; left in place, never deleted.
    pub previous_documents_dir: String,
    pub restart_required: bool,
}

/// Live notes folder used to mirror note changes to Markdown files.
pub struct VaultState {
    notes_dir: Mutex<Option<PathBuf>>,
}

impl VaultState {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            notes_dir: Mutex::new(notes_dir(app_data_dir)),
        }
    }
}

fn read_config(app_data_dir: &Path) -> VaultConfig {
    fs::read_to_string(app_data_dir.join(VAULT_CONFIG_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_config(app_data_dir: &Path, config: &VaultConfig) -> Result<(), String> {
    fs::create_dir_all(app_data_dir).map_err(|e| format!("Failed to create {:?}: {}", app_data_dir, e))?;
    let text = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    let target = app_data_dir.join(VAULT_CONFIG_FILE);
    let staged = app_data_dir.join(format!("{}.tmp", VAULT_CONFIG_FILE));
    fs::write(&staged, text).map_err(|e| format!("Failed to write vault settings: {}", e))?;
    fs::rename(&staged, &target).map_err(|e| format!("Failed to save vault settings: {}", e))
}

/// The chosen vault folder, if one is set and still exists.
pub fn vault_path(app_data_dir: &Path) -> Option<PathBuf> {
    read_config(app_data_dir)
        .path
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
}

/// Where imported documents live. Every part of the app (storage, backup,
/// restore) must resolve the folder through this function.
pub fn attachments_root(app_data_dir: &Path) -> PathBuf {
    match vault_path(app_data_dir) {
        Some(vault) => vault.join(DOCUMENTS_DIR),
        None => app_data_dir.join("attachments"),
    }
}

pub fn notes_dir(app_data_dir: &Path) -> Option<PathBuf> {
    vault_path(app_data_dir).map(|vault| vault.join(NOTES_DIR))
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

// --------------------------------------------------------------------------
// Readable note files
// --------------------------------------------------------------------------

fn short_id(id: &str) -> String {
    id.chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect()
}

/// A safe, readable file name: "<title> (<id>).md". The short id keeps two
/// notes with the same title apart and lets a rename find the old file.
fn note_file_name(record: &KnowledgeRecord) -> String {
    let title = record.title.trim();
    let mut clean: String = title
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    clean = clean.trim_matches(|c: char| c == '.' || c == ' ').to_string();
    if clean.is_empty() {
        clean = "Untitled".to_string();
    }
    if clean.chars().count() > 80 {
        clean = clean.chars().take(80).collect::<String>().trim_end().to_string();
    }
    format!("{} ({}).md", clean, short_id(&record.id))
}

fn yaml_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn note_file_body(record: &KnowledgeRecord) -> String {
    let tags = record
        .tags
        .iter()
        .filter(|tag| !tag.starts_with("reader-note:"))
        .map(|tag| yaml_string(tag))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "---\ntitle: {}\nid: {}\ntags: [{}]\ncreated: {}\nupdated: {}\n---\n\n{}\n",
        yaml_string(&record.title),
        yaml_string(&record.id),
        tags,
        yaml_string(&record.created_at),
        yaml_string(&record.updated_at),
        record.content.trim_end()
    )
}

/// Remove every file that belongs to this note id except `keep`.
fn remove_note_files(dir: &Path, id: &str, keep: Option<&str>) {
    let suffix = format!(" ({}).md", short_id(id));
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(&suffix) && Some(name.as_str()) != keep {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn write_note_file(dir: &Path, record: &KnowledgeRecord) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create {:?}: {}", dir, e))?;
    let name = note_file_name(record);
    let target = dir.join(&name);
    let staged = dir.join(format!(".{}.tmp", short_id(&record.id)));
    {
        let mut file = fs::File::create(&staged).map_err(|e| format!("Failed to write note file: {}", e))?;
        file.write_all(note_file_body(record).as_bytes())
            .map_err(|e| format!("Failed to write note file: {}", e))?;
    }
    fs::rename(&staged, &target).map_err(|e| format!("Failed to save note file: {}", e))?;
    remove_note_files(dir, &record.id, Some(&name));
    Ok(())
}

/// Mirror a saved note into the vault. Failures are logged, never surfaced
/// as save errors: the library database is the source of truth.
pub fn mirror_note(state: &VaultState, record: &KnowledgeRecord) {
    let Ok(guard) = state.notes_dir.lock() else { return };
    if let Some(dir) = guard.as_ref() {
        if let Err(err) = write_note_file(dir, record) {
            eprintln!("[Dace] Could not update vault note file: {}", err);
        }
    }
}

pub fn remove_mirrored_note(state: &VaultState, id: &str) {
    let Ok(guard) = state.notes_dir.lock() else { return };
    if let Some(dir) = guard.as_ref() {
        remove_note_files(dir, id, None);
    }
}

fn export_all_notes(db: &Database, dir: &Path) -> Result<usize, String> {
    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    let summaries = KnowledgeRepository::list_records(&conn, None, Some(i64::MAX), Some(0))?;
    let mut written = 0;
    for summary in summaries {
        if let Some(record) = KnowledgeRepository::get_record(&conn, &summary.id)? {
            write_note_file(dir, &record)?;
            written += 1;
        }
    }
    Ok(written)
}

// --------------------------------------------------------------------------
// Moving documents
// --------------------------------------------------------------------------

/// Copy the document store without deleting the original. Existing files
/// with the same content-addressed name are left alone.
fn copy_tree(src: &Path, dest: &Path) -> Result<usize, String> {
    if !src.exists() {
        fs::create_dir_all(dest).map_err(|e| format!("Failed to create {:?}: {}", dest, e))?;
        return Ok(0);
    }
    fs::create_dir_all(dest).map_err(|e| format!("Failed to create {:?}: {}", dest, e))?;
    let mut copied = 0;
    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read {:?}: {}", src, e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if name.to_string_lossy() == ".staging" {
            continue;
        }
        let from = entry.path();
        let to = dest.join(&name);
        if from.is_dir() {
            copied += copy_tree(&from, &to)?;
        } else if !to.exists() {
            fs::copy(&from, &to).map_err(|e| format!("Failed to copy {:?}: {}", from, e))?;
            copied += 1;
        }
    }
    Ok(copied)
}

fn ensure_writable(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Can't use {:?}: {}", dir, e))?;
    let probe = dir.join(".dace-write-test");
    fs::write(&probe, b"ok").map_err(|e| format!("Dace can't write to {:?}: {}", dir, e))?;
    let _ = fs::remove_file(probe);
    Ok(())
}

// --------------------------------------------------------------------------
// Commands
// --------------------------------------------------------------------------

#[tauri::command]
pub fn get_vault_info(app: AppHandle) -> Result<VaultInfo, String> {
    let data = app_data_dir(&app)?;
    Ok(VaultInfo {
        path: vault_path(&data).map(|p| path_string(&p)),
        documents_dir: path_string(&attachments_root(&data)),
        notes_dir: notes_dir(&data).map(|p| path_string(&p)),
    })
}

#[tauri::command]
pub fn pick_vault_folder(current: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new().set_title("Choose a vault folder for Dace");
    if let Some(value) = current {
        let path = PathBuf::from(value.trim());
        if path.is_dir() {
            dialog = dialog.set_directory(path);
        }
    }
    Ok(dialog.pick_folder().map(|path| path.to_string_lossy().into_owned()))
}

/// Switch the vault (or pass None to return to the app's own folder).
/// Documents are copied, never moved, so the previous copy stays as a
/// fallback; the app restarts to read from the new location.
#[tauri::command]
pub fn set_vault_location(
    app: AppHandle,
    db: State<'_, Database>,
    vault: State<'_, VaultState>,
    path: Option<String>,
) -> Result<VaultChangeResult, String> {
    let data = app_data_dir(&app)?;
    let previous_documents = attachments_root(&data);

    let next = path
        .map(|value| PathBuf::from(value.trim()))
        .filter(|value| !value.as_os_str().is_empty());

    let next_documents = match &next {
        Some(folder) => {
            if !folder.is_absolute() {
                return Err("Choose a full folder path for the vault.".to_string());
            }
            if folder.starts_with(&data) {
                return Err("Choose a folder outside Dace's own data folder.".to_string());
            }
            ensure_writable(folder)?;
            folder.join(DOCUMENTS_DIR)
        }
        None => data.join("attachments"),
    };

    let documents_copied = if next_documents != previous_documents {
        copy_tree(&previous_documents, &next_documents)?
    } else {
        0
    };

    let next_notes = next.as_ref().map(|folder| folder.join(NOTES_DIR));
    let notes_written = match &next_notes {
        Some(dir) => export_all_notes(&db, dir)?,
        None => 0,
    };

    write_config(
        &data,
        &VaultConfig {
            path: next.as_ref().map(|p| path_string(p)),
        },
    )?;

    if let Ok(mut guard) = vault.notes_dir.lock() {
        *guard = next_notes;
    }

    Ok(VaultChangeResult {
        documents_copied,
        notes_written,
        previous_documents_dir: path_string(&previous_documents),
        restart_required: next_documents != previous_documents,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: &str, title: &str) -> KnowledgeRecord {
        KnowledgeRecord {
            id: id.to_string(),
            title: title.to_string(),
            content: "Body".to_string(),
            created_at: "2026-11-27T10:00:00Z".to_string(),
            updated_at: "2026-11-27T10:00:00Z".to_string(),
            tags: vec!["paper".to_string(), "reader-note:abc".to_string()],
        }
    }

    #[test]
    fn file_names_are_safe_and_stable() {
        let name = note_file_name(&record("1234-5678-90ab", "Notes: a/b \"quoted\"?"));
        assert_eq!(name, "Notes a b quoted (12345678).md");
        assert_eq!(note_file_name(&record("zz", "   ")), "Untitled (zz).md");
    }

    #[test]
    fn rename_replaces_the_old_file_and_hides_link_tags() {
        let dir = std::env::temp_dir().join(format!("dace-vault-test-{}", uuid::Uuid::new_v4()));
        let mut note = record("aaaa1111-x", "First");
        write_note_file(&dir, &note).unwrap();
        note.title = "Second".to_string();
        write_note_file(&dir, &note).unwrap();
        let names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["Second (aaaa1111).md".to_string()]);
        let body = fs::read_to_string(dir.join("Second (aaaa1111).md")).unwrap();
        assert!(body.contains("tags: [\"paper\"]"));
        assert!(!body.contains("reader-note:"));
        remove_note_files(&dir, "aaaa1111-x", None);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn default_root_is_app_attachments() {
        let data = std::env::temp_dir().join(format!("dace-vault-cfg-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&data).unwrap();
        assert_eq!(attachments_root(&data), data.join("attachments"));
        let vault = data.with_extension("vault");
        fs::create_dir_all(&vault).unwrap();
        write_config(&data, &VaultConfig { path: Some(path_string(&vault)) }).unwrap();
        assert_eq!(attachments_root(&data), vault.join(DOCUMENTS_DIR));
        let _ = fs::remove_dir_all(&data);
        let _ = fs::remove_dir_all(&vault);
    }
}
