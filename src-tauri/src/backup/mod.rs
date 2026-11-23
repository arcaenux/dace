pub mod archive;
pub mod restore;
pub mod service;

#[cfg(test)]
mod restore_tests;
#[cfg(test)]
mod tests;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::attachments::storage::AttachmentStorage;
use crate::db::Database;
use restore::{RestoreOutcome, RestorePreview, RestoreStartResult};

#[derive(Debug, Clone, Serialize)]
pub struct BackupResult {
    pub archive_path: String,
    pub archive_size: u64,
    pub attachment_count: usize,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub async fn export_backup(
    app: AppHandle,
    destination_path: Option<String>,
) -> Result<BackupResult, String> {
    let dest = match destination_path {
        Some(p) if !p.trim().is_empty() => std::path::PathBuf::from(p),
        _ => {
            let picked = rfd::FileDialog::new()
                .set_title("Export Dace Backup")
                .add_filter("Dace Backup Archive", &["ndarchive"])
                .set_file_name("dace-backup.ndarchive")
                .save_file();
            picked.ok_or_else(|| "Backup export cancelled.".to_string())?
        }
    };

    let app_for_task = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let db = app_for_task.state::<Database>();
        let storage = app_for_task.state::<AttachmentStorage>();
        let app_emit = app_for_task.clone();
        let progress = move |stage: &str, current: usize, total: usize, message: &str| {
            let _ = app_emit.emit(
                "dace://backup-progress",
                serde_json::json!({
                    "stage": stage,
                    "current": current,
                    "total": total,
                    "message": message,
                }),
            );
        };
        service::create_backup_with_progress(db.inner(), storage.inner(), &dest, Some(&progress))
    })
    .await
    .map_err(|e| format!("Backup task failed: {}", e))?
}

/// Validates a `.ndarchive` and returns a preview without touching live data.
/// When no path is supplied, a native file picker is shown.
#[tauri::command]
pub async fn inspect_backup_archive(
    app: AppHandle,
    archive_path: Option<String>,
) -> Result<RestorePreview, String> {
    let path = match archive_path {
        Some(p) if !p.trim().is_empty() => std::path::PathBuf::from(p),
        _ => {
            let picked = rfd::FileDialog::new()
                .set_title("Select Dace Backup to Restore")
                .add_filter("Dace Backup Archive", &["ndarchive"])
                .pick_file();
            picked.ok_or_else(|| "Restore cancelled.".to_string())?
        }
    };

    let app_emit = app.clone();
    let progress = move |stage: &str, current: usize, total: usize, message: &str| {
        let _ = app_emit.emit(
            "dace://restore-inspect-progress",
            serde_json::json!({
                "stage": stage,
                "current": current,
                "total": total,
                "message": message,
            }),
        );
    };

    tauri::async_runtime::spawn_blocking(move || {
        restore::inspect_archive_with_progress(&path, Some(&progress))
    })
    .await
    .map_err(|e| format!("Restore inspection task failed: {}", e))?
}

/// Fully validates and stages a restore, snapshots the current data, writes the
/// pending marker, then restarts the app. The swap itself happens on startup
/// before SQLite is opened. Success is only reported after that verification.
#[tauri::command]
pub async fn restore_backup_archive(
    app: AppHandle,
    archive_path: String,
    expected_archive_size: Option<u64>,
    expected_archive_sha256: Option<String>,
) -> Result<RestoreStartResult, String> {
    let path = std::path::PathBuf::from(archive_path);
    let app_for_task = app.clone();

    let prepared = tauri::async_runtime::spawn_blocking(move || {
        let app_data_dir = app_for_task
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
        let db = app_for_task.state::<Database>();
        let current_db = db.path.clone();
        // Prevent concurrent writes while the recovery snapshot is captured.
        let guard = db
            .conn
            .lock()
            .map_err(|e| format!("Failed to lock database for restore: {}", e))?;
        let app_emit = app_for_task.clone();
        let progress = move |stage: &str, current: usize, total: usize, message: &str| {
            let _ = app_emit.emit(
                "dace://restore-progress",
                serde_json::json!({
                    "stage": stage,
                    "current": current,
                    "total": total,
                    "message": message,
                }),
            );
        };
        let result = restore::prepare_restore_checked(
            &app_data_dir,
            &path,
            current_db.as_deref(),
            Some(&progress),
            expected_archive_size,
            expected_archive_sha256.as_deref(),
        );
        drop(guard);
        result
    })
    .await
    .map_err(|e| format!("Restore task failed: {}", e))??;

    // Give the UI a moment to render the "restarting" state before exiting.
    let app_restart = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1400));
        app_restart.request_restart();
    });

    Ok(prepared)
}

/// Reads (and consumes) the result of the restore applied during startup so the
/// UI can report success or the actual failure/rollback reason once.
#[tauri::command]
pub fn get_restore_result(app: AppHandle) -> Result<Option<RestoreOutcome>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    restore::take_restore_result(&app_data_dir)
}
