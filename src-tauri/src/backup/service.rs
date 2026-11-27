use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

use crate::attachments::storage::AttachmentStorage;
use crate::db::Database;

use super::archive::{
    sanitize_archive_path, sha256_file, validate_backup, write_backup, ArchiveFile,
    AttachmentEntry, BackupManifest, BackupTotals, DatabaseEntry, BACKUP_FORMAT, BACKUP_FORMAT_VERSION,
};
use super::BackupResult;

pub type ProgressCallback = dyn Fn(&str, usize, usize, &str) + Send + Sync;

#[derive(Debug)]
struct DbAttachmentRow {
    id: String,
    file_name: String,
    mime_type: String,
    file_size: i64,
    sha256_hash: String,
    storage_path: String,
}

fn collect_attachment_rows(conn: &Connection) -> Result<Vec<DbAttachmentRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, file_name, mime_type, file_size, sha256_hash, storage_path
             FROM attachments
             ORDER BY created_at ASC, id ASC",
        )
        .map_err(|e| format!("Failed to query attachments: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(DbAttachmentRow {
                id: row.get(0)?,
                file_name: row.get(1)?,
                mime_type: row.get(2)?,
                file_size: row.get(3)?,
                sha256_hash: row.get(4)?,
                storage_path: row.get(5)?,
            })
        })
        .map_err(|e| format!("Failed to read attachments: {}", e))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("Failed to map attachment row: {}", e))?);
    }
    Ok(out)
}

pub fn snapshot_database(db: &Database, temp_db_path: &Path) -> Result<(), String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("Failed to lock database for backup: {}", e))?;

    if let Some(parent) = temp_db_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create snapshot directory {:?}: {}", parent, e))?;
    }

    let mut dest = Connection::open(temp_db_path)
        .map_err(|e| format!("Failed to open backup snapshot database: {}", e))?;

    {
        let backup = rusqlite::backup::Backup::new(&*conn, &mut dest)
            .map_err(|e| format!("Failed to initialize SQLite backup: {}", e))?;
        backup
            .run_to_completion(5, std::time::Duration::from_millis(50), None)
            .map_err(|e| format!("Failed to create consistent database snapshot: {}", e))?;
    }

    // Quick integrity check on snapshot
    let integrity: String = dest
        .query_row("PRAGMA quick_check;", [], |row| row.get(0))
        .map_err(|e| format!("Failed to verify database snapshot: {}", e))?;
    if integrity != "ok" {
        return Err(format!("Database snapshot integrity check failed: {}", integrity));
    }

    Ok(())
}

pub fn create_backup_with_progress(
    db: &Database,
    storage: &AttachmentStorage,
    destination_path: &Path,
    progress: Option<&ProgressCallback>,
) -> Result<BackupResult, String> {
    let report = |stage: &str, current: usize, total: usize, message: &str| {
        if let Some(cb) = progress {
            cb(stage, current, total, message);
        }
    };

    let dest = if destination_path.extension().and_then(|e| e.to_str()).is_some() {
        destination_path.to_path_buf()
    } else {
        destination_path.with_extension("dacebackup")
    };

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create backup destination directory {:?}: {}", parent, e))?;
    }

    let work_dir = dest
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join(format!(".dace-backup-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&work_dir)
        .map_err(|e| format!("Failed to create temporary backup workspace: {}", e))?;

    let result = (|| {
        report("snapshot", 0, 1, "Creating consistent database snapshot…");
        let snapshot_path = work_dir.join("dace.db");
        snapshot_database(db, &snapshot_path)?;
        let (db_hash, db_size) = sha256_file(&snapshot_path)?;
        let schema_version = {
            let conn = db
                .conn
                .lock()
                .map_err(|e| format!("Failed to lock database: {}", e))?;
            Database::schema_version(&conn)
                .map_err(|e| format!("Failed to read schema version: {}", e))?
        };

        report("inventory", 0, 1, "Collecting managed attachment inventory…");
        let rows = {
            let conn = db
                .conn
                .lock()
                .map_err(|e| format!("Failed to lock database: {}", e))?;
            collect_attachment_rows(&conn)?
        };

        let mut attachment_entries: Vec<AttachmentEntry> = Vec::new();
        let mut archive_files: Vec<ArchiveFile> = Vec::new();
        let mut errors: Vec<String> = Vec::new();
        let mut attachment_bytes: u64 = 0;

        archive_files.push(ArchiveFile {
            archive_path: "database/dace.db".to_string(),
            source_path: snapshot_path.clone(),
            sha256_hex: db_hash.clone(),
            size: db_size,
        });

        let total = rows.len();
        for (idx, row) in rows.iter().enumerate() {
            report(
                "attachments",
                idx + 1,
                total,
                &format!(
                    "Verifying attachment {}/{}: {}",
                    idx + 1,
                    total,
                    row.file_name
                ),
            );

            let rel = sanitize_archive_path(&row.storage_path).map_err(|e| {
                format!("Invalid attachment storage path '{}': {}", row.storage_path, e)
            })?;
            let full_path = storage
                .resolve_path(&row.storage_path)
                .map_err(|e| format!("Attachment '{}' ({}): {}", row.file_name, row.id, e))?;

            if !full_path.exists() {
                errors.push(format!(
                    "Missing attachment file: {} (id={}, path={})",
                    row.file_name, row.id, row.storage_path
                ));
                continue;
            }

            let (exists, integrity_ok) =
                storage.verify_integrity(&row.storage_path, &row.sha256_hash);
            if !exists {
                errors.push(format!(
                    "Missing attachment during integrity verification: {} (id={}, path={})",
                    row.file_name, row.id, row.storage_path
                ));
                continue;
            }
            if !integrity_ok {
                errors.push(format!(
                    "Corrupted attachment (checksum mismatch): {} (id={}, path={}, expected_sha256={})",
                    row.file_name, row.id, row.storage_path, row.sha256_hash
                ));
                continue;
            }

            let (actual_hash, actual_size) = sha256_file(&full_path)?;
            if !actual_hash.eq_ignore_ascii_case(&row.sha256_hash) {
                errors.push(format!(
                    "Attachment hash mismatch: {} (id={}, path={}, expected={}, actual={})",
                    row.file_name, row.id, row.storage_path, row.sha256_hash, actual_hash
                ));
                continue;
            }

            let archive_path = sanitize_archive_path(&format!("attachments/{}", rel))?;
            attachment_entries.push(AttachmentEntry {
                archive_path: archive_path.clone(),
                relative_path: rel,
                file_name: row.file_name.clone(),
                mime_type: row.mime_type.clone(),
                db_file_size: row.file_size,
                sha256: actual_hash.clone(),
                size: actual_size,
                attachment_id: row.id.clone(),
            });
            archive_files.push(ArchiveFile {
                archive_path,
                source_path: full_path,
                sha256_hex: actual_hash,
                size: actual_size,
            });
            attachment_bytes += actual_size;
        }

        if !errors.is_empty() {
            let mut report_err = String::from(
                "Backup aborted: one or more managed attachments failed integrity verification:\n",
            );
            for e in errors.iter().take(50) {
                report_err.push_str("- ");
                report_err.push_str(e);
                report_err.push('\n');
            }
            if errors.len() > 50 {
                report_err.push_str(&format!("... and {} more issue(s)\n", errors.len() - 50));
            }
            report_err.push_str("No archive was published.");
            return Err(report_err);
        }

        let source_db_name = db
            .path
            .as_ref()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("dace.db")
            .to_string();

        let manifest = BackupManifest {
            format: BACKUP_FORMAT.to_string(),
            format_version: BACKUP_FORMAT_VERSION,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            schema_version,
            created_at: chrono::Utc::now().to_rfc3339(),
            database: DatabaseEntry {
                archive_path: "database/dace.db".to_string(),
                source_name: source_db_name,
                size: db_size,
                sha256: db_hash,
            },
            totals: BackupTotals {
                attachment_count: attachment_entries.len(),
                attachment_bytes,
                database_bytes: db_size,
                total_bytes: db_size + attachment_bytes,
            },
            attachments: attachment_entries,
        };

        report("archive", 0, 1, "Writing backup archive…");
        let tmp_archive = dest.with_extension(format!("dacebackup.tmp-{}", uuid::Uuid::new_v4()));
        let written = match write_backup(&tmp_archive, &manifest, &archive_files) {
            Ok(size) => size,
            Err(e) => {
                let _ = fs::remove_file(&tmp_archive);
                return Err(e);
            }
        };

        report("validate", 0, 1, "Validating backup archive…");
        if let Err(e) = validate_backup(&tmp_archive) {
            let _ = fs::remove_file(&tmp_archive);
            return Err(format!("Archive validation failed: {}", e));
        }

        // Publish final archive (do not overwrite source data; destination is user-selected output)
        if dest.exists() {
            let _ = fs::remove_file(&dest);
        }
        fs::rename(&tmp_archive, &dest).or_else(|rename_err| {
            fs::copy(&tmp_archive, &dest)
                .map_err(|copy_err| {
                    format!(
                        "Failed to publish backup archive: rename error: {}, copy error: {}",
                        rename_err, copy_err
                    )
                })
                .and_then(|_| {
                    fs::remove_file(&tmp_archive).map_err(|e| {
                        format!("Failed to remove temporary archive after publish: {}", e)
                    })
                })
        })?;

        report("complete", 1, 1, "Backup export completed.");
        Ok(BackupResult {
            archive_path: dest.to_string_lossy().to_string(),
            archive_size: written,
            attachment_count: manifest.totals.attachment_count,
            warnings: Vec::new(),
        })
    })();

    let _ = fs::remove_dir_all(&work_dir);
    result
}

// Tauri command wrapper uses create_backup_with_progress with an event-emitting callback (see backup::mod).