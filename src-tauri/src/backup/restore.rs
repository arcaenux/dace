//! Safe restore of `.ndarchive` v1 backups.
//!
//! Restores never write into the live application data directory while the app is
//! running. The archive is fully validated and extracted into a staging directory,
//! the current data is snapshotted for recovery, and a pending-restore marker is
//! written. The actual replacement happens on the next startup *before* SQLite or
//! attachment-storage handles are opened, which avoids Windows locked-file issues.
//!
//! Every apply step is reversible: if anything fails (or the process is interrupted
//! mid-swap) the previous environment is restored from `active-before-swap/` and the
//! recovery snapshot is retained.

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::attachments::storage::AttachmentStorage;
use crate::db::{Database, SCHEMA_VERSION};

use super::archive::{
    extract_ndarchive, safe_join, sanitize_archive_path, sha256_file, BackupManifest,
    NDARCHIVE_DATABASE_PATH,
};
use super::service::ProgressCallback;

pub const RESTORE_MARKER_FILE: &str = "restore_pending.json";
pub const RESTORE_FAILED_MARKER_FILE: &str = "restore_pending.failed.json";
pub const RESTORE_RESULT_FILE: &str = "restore_last_result.json";
pub const RESTORE_STAGING_DIR: &str = "restore_staging";
pub const RESTORE_RECOVERY_DIR: &str = "restore_recovery";

const MARKER_VERSION: u32 = 1;
const KEEP_RECOVERY_SNAPSHOTS: usize = 5;
const PHASE_PREPARED: &str = "prepared";
const PHASE_APPLYING: &str = "applying";
const PHASE_VERIFIED: &str = "verified";

const ACTIVE_DB_FILE_NAMES: [&str; 6] = [
    "dace.db",
    "dace.db-wal",
    "dace.db-shm",
    "novadome.db",
    "novadome.db-wal",
    "novadome.db-shm",
];

/// Everything a user needs to see before confirming a destructive restore.
/// Produced from a fully validated, isolated extraction of the archive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestorePreview {
    pub archive_path: String,
    pub archive_size: u64,
    pub archive_sha256: String,
    pub created_at: String,
    pub app_version: String,
    pub schema_version: i64,
    pub record_count: i64,
    pub tag_count: i64,
    pub relationship_count: i64,
    pub attachment_count: i64,
    pub highlight_count: i64,
    pub annotation_count: i64,
    pub validation_status: String,
    pub warnings: Vec<String>,
}

/// Returned when a restore has been staged and the app is about to restart.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreStartResult {
    pub preview: RestorePreview,
    pub restart_required: bool,
    pub recovery_dir: String,
}

/// Result of the most recent applied restore, persisted across the restart.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreOutcome {
    pub success: bool,
    pub message: String,
    pub archive_path: Option<String>,
    pub record_count: Option<i64>,
    pub attachment_count: Option<i64>,
    pub recovery_dir: Option<String>,
    pub completed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PendingRestore {
    marker_version: u32,
    phase: String,
    archive_path: String,
    staging_dir: String,
    recovery_dir: String,
    database_snapshot: String,
    previous_db_name: Option<String>,
    previous_record_count: Option<i64>,
    previous_attachment_count: Option<i64>,
    schema_version: i64,
    record_count: i64,
    attachment_count: i64,
    created_at: String,
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn now_stamp() -> String {
    format!(
        "{}-{}",
        chrono::Utc::now().format("%Y%m%dT%H%M%S"),
        &uuid::Uuid::new_v4().simple().to_string()[..8]
    )
}

fn report(progress: Option<&ProgressCallback>, stage: &str, message: &str) {
    if let Some(cb) = progress {
        cb(stage, 0, 1, message);
    }
}

fn archive_display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

/// Copies the selected archive into an isolated directory and fingerprints that
/// copy. Extraction then reads the copy, so a later change to the user's original
/// file cannot make the staged data diverge from the fingerprint shown in the
/// preview.
pub(crate) fn snapshot_archive(
    archive_path: &Path,
    dest_dir: &Path,
    progress: Option<&ProgressCallback>,
) -> Result<(PathBuf, u64, String), String> {
    fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create archive snapshot directory {:?}: {}", dest_dir, e))?;
    let snapshot = dest_dir.join("archive.ndarchive");
    report(
        progress,
        "fingerprint",
        &format!("Copying and fingerprinting {}…", archive_display_name(archive_path)),
    );
    fs::copy(archive_path, &snapshot)
        .map_err(|e| format!("Failed to snapshot archive {:?}: {}", archive_path, e))?;
    let (archive_sha256, archive_size) = sha256_file(&snapshot)
        .map_err(|e| format!("Failed to fingerprint archive snapshot {:?}: {}", snapshot, e))?;
    Ok((snapshot, archive_size, archive_sha256))
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|e| format!("Failed to read {:?}: {}", path, e))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Failed to parse {:?}: {}", path, e))
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|e| format!("Failed to serialize {:?}: {}", path, e))?;
    let tmp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4().simple()));
    {
        use std::io::Write;
        let mut file =
            fs::File::create(&tmp).map_err(|e| format!("Failed to create {:?}: {}", tmp, e))?;
        file.write_all(&bytes)
            .map_err(|e| format!("Failed to write {:?}: {}", tmp, e))?;
        file.flush()
            .map_err(|e| format!("Failed to flush {:?}: {}", tmp, e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to sync {:?}: {}", tmp, e))?;
    }
    // `fs::rename` replaces an existing file on both Windows and Unix. Removing
    // the destination first would create a window in which a crash leaves no
    // marker/result file at all, so always publish with a single rename.
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Failed to publish {:?}: {}", path, e)
    })
}

fn remove_any(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let meta = fs::symlink_metadata(path)
        .map_err(|e| format!("Failed to inspect {:?}: {}", path, e))?;
    if meta.is_dir() {
        fs::remove_dir_all(path).map_err(|e| format!("Failed to remove {:?}: {}", path, e))
    } else {
        fs::remove_file(path).map_err(|e| format!("Failed to remove {:?}: {}", path, e))
    }
}

fn copy_any(src: &Path, dest: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(src)
        .map_err(|e| format!("Failed to inspect {:?}: {}", src, e))?;
    if meta.file_type().is_symlink() {
        return Err(format!("Refusing to copy symlink: {:?}", src));
    }
    if meta.is_dir() {
        fs::create_dir_all(dest).map_err(|e| format!("Failed to create {:?}: {}", dest, e))?;
        for entry in fs::read_dir(src)
            .map_err(|e| format!("Failed to read directory {:?}: {}", src, e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
            copy_any(&entry.path(), &dest.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {:?}: {}", parent, e))?;
        }
        fs::copy(src, dest)
            .map_err(|e| format!("Failed to copy {:?} to {:?}: {}", src, dest, e))?;
        Ok(())
    }
}

/// Moves a file or directory, falling back to copy+remove across volumes.
/// The destination must not already exist.
fn move_any(src: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {:?}: {}", parent, e))?;
    }
    match fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(rename_err) => {
            copy_any(src, dest).map_err(|copy_err| {
                format!(
                    "Failed to move {:?} to {:?}: rename error: {}, copy error: {}",
                    src, dest, rename_err, copy_err
                )
            })?;
            remove_any(src)
                .map_err(|e| format!("Moved data but failed to remove {:?}: {}", src, e))?;
            Ok(())
        }
    }
}

fn copy_directory_filtered(src: &Path, dest: &Path) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }
    fs::create_dir_all(dest).map_err(|e| format!("Failed to create {:?}: {}", dest, e))?;
    for entry in fs::read_dir(src)
        .map_err(|e| format!("Failed to read directory {:?}: {}", src, e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let name = entry.file_name();
        // Never copy transient ingestion files into a recovery snapshot.
        if name.to_string_lossy() == ".staging" {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to inspect {:?}: {}", entry.path(), e))?;
        if file_type.is_symlink() {
            continue;
        }
        copy_any(&entry.path(), &dest.join(name))?;
    }
    Ok(())
}

fn count_table(conn: &Connection, table: &str, schema_version: i64, min_schema: i64) -> Result<i64, String> {
    if schema_version < min_schema {
        return Ok(0);
    }
    conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |row| row.get(0))
        .map_err(|e| format!("Failed to count {} rows: {}", table, e))
}

fn required_tables(schema_version: i64) -> Vec<&'static str> {
    let mut tables = vec!["schema_migrations", "records", "tags", "record_tags"];
    if schema_version >= 2 {
        tables.push("record_relationships");
    }
    if schema_version >= 3 {
        tables.push("attachments");
        tables.push("record_attachments");
    }
    if schema_version >= 4 {
        tables.push("highlights");
        tables.push("annotations");
        tables.push("highlight_records");
    }
    tables
}

fn check_required_tables(conn: &Connection, schema_version: i64) -> Result<(), String> {
    for table in required_tables(schema_version) {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [table],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to inspect database schema: {}", e))?;
        if count == 0 {
            return Err(format!(
                "Restored database is missing required table '{}'",
                table
            ));
        }
    }
    Ok(())
}

fn verify_database_integrity(conn: &Connection) -> Result<(), String> {
    let integrity: String = conn
        .query_row("PRAGMA quick_check;", [], |row| row.get(0))
        .map_err(|e| format!("Failed to run database integrity check: {}", e))?;
    if integrity != "ok" {
        return Err(format!("Database integrity check failed: {}", integrity));
    }

    let mut stmt = conn
        .prepare("PRAGMA foreign_key_check;")
        .map_err(|e| format!("Failed to run foreign key check: {}", e))?;
    let mut rows = stmt
        .query([])
        .map_err(|e| format!("Failed to run foreign key check: {}", e))?;
    if let Some(row) = rows
        .next()
        .map_err(|e| format!("Failed to run foreign key check: {}", e))?
    {
        let table: String = row.get(0).unwrap_or_else(|_| "unknown".to_string());
        return Err(format!(
            "Database contains broken foreign key references (table '{}')",
            table
        ));
    }
    Ok(())
}

fn open_readonly(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open database {:?}: {}", path, e))
}

struct ExtractedAttachmentRow {
    file_name: String,
    file_size: i64,
    sha256_hash: String,
    storage_path: String,
}

fn read_attachment_rows(conn: &Connection) -> Result<Vec<ExtractedAttachmentRow>, String> {
    let mut stmt = conn
        .prepare("SELECT file_name, file_size, sha256_hash, storage_path FROM attachments")
        .map_err(|e| format!("Failed to read attachment inventory: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ExtractedAttachmentRow {
                file_name: row.get(0)?,
                file_size: row.get(1)?,
                sha256_hash: row.get(2)?,
                storage_path: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to read attachment inventory: {}", e))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("Failed to read attachment row: {}", e))?);
    }
    Ok(out)
}

/// Validates the extracted database and cross-checks it against the manifest's
/// attachment inventory and the extracted attachment files.
fn inspect_extracted(
    extract_dir: &Path,
    manifest: &BackupManifest,
    archive_path: &Path,
    archive_size: u64,
    archive_sha256: &str,
    on_progress: Option<&dyn Fn(&str, usize, usize, &str)>,
) -> Result<RestorePreview, String> {
    let db_path = safe_join(extract_dir, NDARCHIVE_DATABASE_PATH)?;
    if !db_path.exists() {
        return Err("Archive does not contain the required database file".to_string());
    }

    if let Some(cb) = on_progress {
        cb("database", 0, 1, "Checking restored database integrity…");
    }

    let conn = open_readonly(&db_path)?;
    verify_database_integrity(&conn)?;

    let schema_version = Database::schema_version(&conn)
        .map_err(|e| format!("Failed to read database schema version: {}", e))?;
    if schema_version != manifest.schema_version {
        return Err(format!(
            "Archive manifest schema version ({}) does not match the database schema version ({})",
            manifest.schema_version, schema_version
        ));
    }
    if schema_version > SCHEMA_VERSION {
        return Err(format!(
            "Backup uses schema version {}, which is newer than this Dace build supports ({}). Please update Dace before restoring this archive.",
            schema_version, SCHEMA_VERSION
        ));
    }
    check_required_tables(&conn, schema_version)?;

    let record_count = count_table(&conn, "records", schema_version, 1)?;
    let tag_count = count_table(&conn, "tags", schema_version, 1)?;
    let relationship_count = count_table(&conn, "record_relationships", schema_version, 2)?;
    let attachment_count = count_table(&conn, "attachments", schema_version, 3)?;
    let highlight_count = count_table(&conn, "highlights", schema_version, 4)?;
    let annotation_count = count_table(&conn, "annotations", schema_version, 4)?;

    if schema_version >= 3 {
        let rows = read_attachment_rows(&conn)?;
        if rows.len() as i64 != attachment_count {
            return Err("Restored attachment inventory is internally inconsistent".to_string());
        }
        if rows.len() != manifest.attachments.len() {
            return Err(format!(
                "Attachment inventory mismatch: database references {} managed attachments but the archive manifest lists {}",
                rows.len(),
                manifest.attachments.len()
            ));
        }

        let total = rows.len();
        for (index, row) in rows.iter().enumerate() {
            if let Some(cb) = on_progress {
                cb(
                    "attachments",
                    index + 1,
                    total,
                    &format!("Verifying restored attachment {}/{}: {}", index + 1, total, row.file_name),
                );
            }
            let entry = manifest
                .attachments
                .iter()
                .find(|attachment| attachment.relative_path == row.storage_path)
                .ok_or_else(|| {
                    format!(
                        "Database attachment '{}' has no matching archive entry",
                        row.file_name
                    )
                })?;
            if entry.relative_path != row.storage_path {
                return Err(format!(
                    "Attachment '{}' storage path in the database does not match the archive inventory",
                    row.file_name
                ));
            }
            if !entry.sha256.eq_ignore_ascii_case(&row.sha256_hash) {
                return Err(format!(
                    "Attachment '{}' checksum in the database does not match the archive inventory",
                    row.file_name
                ));
            }
            if entry.size != row.file_size.max(0) as u64 {
                return Err(format!(
                    "Attachment '{}' size in the database does not match the archive inventory",
                    row.file_name
                ));
            }

            let restored = safe_join(
                &extract_dir.join("attachments"),
                &sanitize_archive_path(&entry.relative_path)?,
            )?;
            let (actual_hash, actual_size) = sha256_file(&restored).map_err(|e| {
                format!(
                    "Restored attachment '{}' is missing or unreadable: {}",
                    row.file_name, e
                )
            })?;
            if actual_size != entry.size || !actual_hash.eq_ignore_ascii_case(&row.sha256_hash) {
                return Err(format!(
                    "Restored attachment '{}' failed size/checksum verification",
                    row.file_name
                ));
            }
        }
    } else if !manifest.attachments.is_empty() {
        return Err(
            "Archive lists managed attachments but its database has no attachment schema".to_string(),
        );
    }

    let mut warnings = Vec::new();
    if schema_version < SCHEMA_VERSION {
        warnings.push(format!(
            "Backup uses schema version {}; Dace will upgrade it to version {} on start.",
            schema_version, SCHEMA_VERSION
        ));
    }

    Ok(RestorePreview {
        archive_path: archive_path.to_string_lossy().to_string(),
        archive_size,
        archive_sha256: archive_sha256.to_string(),
        created_at: manifest.created_at.clone(),
        app_version: manifest.app_version.clone(),
        schema_version,
        record_count,
        tag_count,
        relationship_count,
        attachment_count,
        highlight_count,
        annotation_count,
        validation_status: "valid".to_string(),
        warnings,
    })
}

/// Read-only archive inspection used by the preview UI. Nothing is written into
/// the live application data directory.
pub fn inspect_archive(archive_path: &Path) -> Result<RestorePreview, String> {
    inspect_archive_with_progress(archive_path, None)
}

/// Same as [`inspect_archive`], with progress for fingerprinting, extraction and
/// integrity verification. The archive is copied and verified from an isolated
/// snapshot so the preview describes exactly the bytes that were inspected.
pub fn inspect_archive_with_progress(
    archive_path: &Path,
    progress: Option<&ProgressCallback>,
) -> Result<RestorePreview, String> {
    let inspect_dir =
        std::env::temp_dir().join(format!("dace-restore-inspect-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&inspect_dir)
        .map_err(|e| format!("Failed to create inspection directory: {}", e))?;

    let result = (|| {
        let (stable_archive, archive_size, archive_sha256) =
            snapshot_archive(archive_path, &inspect_dir, progress)?;
        report(progress, "extract", "Extracting archive into isolated inspection area…");
        let manifest = extract_ndarchive(&stable_archive, &inspect_dir)?;
        report(progress, "verify", "Verifying database and attachment integrity…");
        inspect_extracted(
            &inspect_dir,
            &manifest,
            archive_path,
            archive_size,
            &archive_sha256,
            progress.map(|p| p as &dyn Fn(&str, usize, usize, &str)),
        )
    })();

    let _ = fs::remove_dir_all(&inspect_dir);
    result
}

fn snapshot_current_database(current_db: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create recovery directory {:?}: {}", parent, e))?;
    }
    let source = Connection::open(current_db)
        .map_err(|e| format!("Failed to open current database for recovery snapshot: {}", e))?;
    let mut dest_conn = Connection::open(dest)
        .map_err(|e| format!("Failed to create recovery database snapshot: {}", e))?;
    {
        let backup = rusqlite::backup::Backup::new(&source, &mut dest_conn)
            .map_err(|e| format!("Failed to initialize recovery snapshot: {}", e))?;
        backup
            .run_to_completion(5, std::time::Duration::from_millis(50), None)
            .map_err(|e| format!("Failed to capture recovery database snapshot: {}", e))?;
    }
    verify_database_integrity(&dest_conn)?;
    Ok(())
}

fn current_counts(current_db: &Path) -> Option<(i64, i64)> {
    let conn = open_readonly(current_db).ok()?;
    let schema = Database::schema_version(&conn).ok()?;
    let records = count_table(&conn, "records", schema, 1).ok()?;
    let attachments = count_table(&conn, "attachments", schema, 3).ok()?;
    Some((records, attachments))
}

/// Validates the archive, extracts it into staging, verifies the staged environment,
/// creates a recovery snapshot of the current data, and writes the pending-restore
/// marker. No live application data is modified.
pub fn prepare_restore(
    app_data_dir: &Path,
    archive_path: &Path,
    current_db_path: Option<&Path>,
    progress: Option<&ProgressCallback>,
) -> Result<RestoreStartResult, String> {
    prepare_restore_checked(app_data_dir, archive_path, current_db_path, progress, None, None)
}

/// Same as [`prepare_restore`], but refuses to stage an archive that changed after
/// the user reviewed its preview. The size and SHA-256 come from that preview.
#[allow(clippy::too_many_arguments)]
pub fn prepare_restore_checked(
    app_data_dir: &Path,
    archive_path: &Path,
    current_db_path: Option<&Path>,
    progress: Option<&ProgressCallback>,
    expected_archive_size: Option<u64>,
    expected_archive_sha256: Option<&str>,
) -> Result<RestoreStartResult, String> {
    let marker_path = app_data_dir.join(RESTORE_MARKER_FILE);
    if marker_path.exists() {
        return Err(
            "A restore is already pending. Restart Dace to complete or roll back that restore first."
                .to_string(),
        );
    }
    if let Some(expected) = expected_archive_size {
        let actual = fs::metadata(archive_path)
            .map_err(|e| format!("Failed to read archive {:?}: {}", archive_path, e))?
            .len();
        if actual != expected {
            return Err(
                "The backup archive changed since it was reviewed. Please inspect it again."
                    .to_string(),
            );
        }
    }

    // Snapshot first, then verify and extract from that snapshot. The original
    // path is kept only for display and marker metadata.
    let snapshot_dir = safe_join(
        app_data_dir,
        &format!("{}/.preview-{}", RESTORE_STAGING_DIR, uuid::Uuid::new_v4().simple()),
    )?;
    let result = (|| {
        let (stable_archive, archive_size, archive_sha256) =
            snapshot_archive(archive_path, &snapshot_dir, progress)?;
        if let Some(expected) = expected_archive_size {
            if archive_size != expected {
                return Err(
                    "The backup archive changed since it was reviewed. Please inspect it again."
                        .to_string(),
                );
            }
        }
        if let Some(expected) = expected_archive_sha256 {
            if !archive_sha256.eq_ignore_ascii_case(expected) {
                return Err(
                    "The backup archive changed since it was reviewed. Please inspect it again."
                        .to_string(),
                );
            }
        }

        prepare_restore_inner(
            app_data_dir,
            &stable_archive,
            archive_path,
            current_db_path,
            progress,
            archive_size,
            archive_sha256,
        )
    })();
    let _ = fs::remove_dir_all(&snapshot_dir);
    result
}

fn prepare_restore_inner(
    app_data_dir: &Path,
    archive_path: &Path,
    reported_archive_path: &Path,
    current_db_path: Option<&Path>,
    progress: Option<&ProgressCallback>,
    archive_size: u64,
    archive_sha256: String,
) -> Result<RestoreStartResult, String> {
    let marker_path = app_data_dir.join(RESTORE_MARKER_FILE);
    let staging_rel = format!("{}/{}", RESTORE_STAGING_DIR, now_stamp());
    let staging_dir = safe_join(app_data_dir, &staging_rel)?;
    let recovery_rel = format!("{}/{}", RESTORE_RECOVERY_DIR, now_stamp());
    let recovery_dir = safe_join(app_data_dir, &recovery_rel)?;

    let result = (|| {
        report(progress, "validate", "Validating backup archive…");
        let manifest = extract_ndarchive(archive_path, &staging_dir)?;

        report(progress, "verify", "Verifying restored database and attachments…");
        let preview = inspect_extracted(
            &staging_dir,
            &manifest,
            reported_archive_path,
            archive_size,
            &archive_sha256,
            progress.map(|p| p as &dyn Fn(&str, usize, usize, &str)),
        )?;

        report(progress, "recovery", "Creating recovery snapshot of current data…");
        fs::create_dir_all(&recovery_dir)
            .map_err(|e| format!("Failed to create recovery directory: {}", e))?;

        let previous_db_name = current_db_path
            .filter(|path| path.exists())
            .and_then(|path| path.file_name())
            .and_then(|name| name.to_str())
            .map(|name| name.to_string());

        let mut previous_counts: Option<(i64, i64)> = None;
        let database_snapshot_rel = "database-snapshot/dace.db".to_string();
        if let Some(current_db) = current_db_path.filter(|path| path.exists()) {
            let snapshot_path = recovery_dir.join("database-snapshot").join("dace.db");
            snapshot_current_database(current_db, &snapshot_path)?;
            // Derive rollback expectations from the snapshot itself so a concurrent
            // write cannot make later rollback verification report a false mismatch.
            previous_counts = current_counts(&snapshot_path);
        }

        let attachments_dir = app_data_dir.join("attachments");
        copy_directory_filtered(&attachments_dir, &recovery_dir.join("attachments"))?;

        let recovery_meta = serde_json::json!({
            "created_at": now_rfc3339(),
            "archive_path": reported_archive_path.to_string_lossy(),
            "app_version": manifest.app_version,
            "schema_version": manifest.schema_version,
            "record_count": preview.record_count,
            "attachment_count": preview.attachment_count,
            "previous_db_name": previous_db_name,
        });
        write_json_atomic(&recovery_dir.join("metadata.json"), &recovery_meta)?;
        write_json_atomic(&recovery_dir.join("manifest.json"), &manifest)?;

        let pending = PendingRestore {
            marker_version: MARKER_VERSION,
            phase: PHASE_PREPARED.to_string(),
            archive_path: reported_archive_path.to_string_lossy().to_string(),
            staging_dir: staging_rel,
            recovery_dir: recovery_rel,
            database_snapshot: database_snapshot_rel,
            previous_db_name,
            previous_record_count: previous_counts.map(|(records, _)| records),
            previous_attachment_count: previous_counts.map(|(_, attachments)| attachments),
            schema_version: preview.schema_version,
            record_count: preview.record_count,
            attachment_count: preview.attachment_count,
            created_at: now_rfc3339(),
        };
        write_json_atomic(&marker_path, &pending)?;

        report(progress, "prepared", "Restore prepared. Restart required to apply it safely.");
        Ok(RestoreStartResult {
            preview,
            restart_required: true,
            recovery_dir: recovery_dir.to_string_lossy().to_string(),
        })
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&staging_dir);
        let _ = fs::remove_dir_all(&recovery_dir);
    }
    result
}

fn verify_installed_environment(
    app_data_dir: &Path,
    pending: &PendingRestore,
) -> Result<(), String> {
    let db_path = app_data_dir.join("dace.db");
    if !db_path.exists() {
        return Err("Restored database file is missing after replacement".to_string());
    }
    let conn = open_readonly(&db_path)?;
    verify_database_integrity(&conn)?;

    let schema_version = Database::schema_version(&conn)
        .map_err(|e| format!("Failed to read restored schema version: {}", e))?;
    if schema_version != pending.schema_version {
        return Err(format!(
            "Restored database schema version {} does not match the validated backup ({})",
            schema_version, pending.schema_version
        ));
    }
    check_required_tables(&conn, schema_version)?;

    let records = count_table(&conn, "records", schema_version, 1)?;
    if records != pending.record_count {
        return Err(format!(
            "Restored record count {} does not match the validated backup ({})",
            records, pending.record_count
        ));
    }
    let attachments = count_table(&conn, "attachments", schema_version, 3)?;
    if attachments != pending.attachment_count {
        return Err(format!(
            "Restored attachment count {} does not match the validated backup ({})",
            attachments, pending.attachment_count
        ));
    }

    if schema_version >= 3 {
        let rows = read_attachment_rows(&conn)?;
        for row in rows {
            let relative = sanitize_archive_path(&row.storage_path)?;
            let file = safe_join(&app_data_dir.join("attachments"), &relative)?;
            let (hash, size) = sha256_file(&file).map_err(|e| {
                format!(
                    "Restored attachment '{}' could not be verified: {}",
                    row.file_name, e
                )
            })?;
            if size != row.file_size.max(0) as u64 || !hash.eq_ignore_ascii_case(&row.sha256_hash) {
                return Err(format!(
                    "Restored attachment '{}' failed checksum verification",
                    row.file_name
                ));
            }
        }
    }

    Ok(())
}

/// Removes the partially installed environment and restores whatever the apply
/// step moved into `active-before-swap/`. Designed to be safe at any interruption
/// point: files without a saved counterpart are left alone.
fn rollback_restore(
    app_data_dir: &Path,
    pending: &PendingRestore,
    staging_dir: &Path,
    recovery_dir: &Path,
) -> Result<(), String> {
    let before_swap = recovery_dir.join("active-before-swap");
    fs::create_dir_all(staging_dir)
        .map_err(|e| format!("Failed to prepare rollback staging directory: {}", e))?;

    // If nothing was saved, the crash happened before the swap began. In that
    // case unsaved WAL/SHM files belong to the original environment and must be
    // left alone because they can contain committed, uncheckpointed data. Once
    // the swap has started, unsaved sidecars can only belong to the failed
    // restore and must not be left beside the rolled-back database.
    let swap_started = before_swap.join("dace.db").exists()
        || before_swap.join("novadome.db").exists()
        || before_swap.join("attachments").exists();
    let mut restored_saved_sidecar = false;

    for name in ACTIVE_DB_FILE_NAMES {
        let saved = before_swap.join(name);
        let active = app_data_dir.join(name);
        let is_sidecar = name.ends_with("-wal") || name.ends_with("-shm");
        if saved.exists() {
            if active.exists() {
                remove_any(&active)?;
            }
            move_any(&saved, &active)?;
            if is_sidecar {
                restored_saved_sidecar = true;
            }
        } else if is_sidecar {
            if swap_started && active.exists() {
                remove_any(&active)?;
            }
        } else if name == "dace.db" && pending.previous_db_name.as_deref() != Some("dace.db") {
            // No previous dace.db existed; the installed database must be removed.
            if active.exists() {
                remove_any(&active)?;
            }
        } else if name == "novadome.db" && swap_started && active.exists() {
            // A legacy database from the failed environment must not survive.
            remove_any(&active)?;
        }
    }

    let saved_attachments = before_swap.join("attachments");
    let active_attachments = app_data_dir.join("attachments");
    if saved_attachments.exists() {
        if active_attachments.exists() {
            let parked = staging_dir.join(format!(
                "failed-installed-attachments-{}",
                uuid::Uuid::new_v4().simple()
            ));
            move_any(&active_attachments, &parked).or_else(|_| remove_any(&active_attachments))?;
        }
        move_any(&saved_attachments, &active_attachments)?;
    }

    verify_rollback(app_data_dir, pending)?;

    // Read-only verification in WAL mode may recreate an empty -shm file. Clean
    // it up when there was no original sidecar to preserve.
    if swap_started && !restored_saved_sidecar {
        for name in ACTIVE_DB_FILE_NAMES {
            if name.ends_with("-wal") || name.ends_with("-shm") {
                let path = app_data_dir.join(name);
                if path.exists() {
                    remove_any(&path)?;
                }
            }
        }
    }

    Ok(())
}

fn verify_rollback(app_data_dir: &Path, pending: &PendingRestore) -> Result<(), String> {
    let Some(db_name) = pending.previous_db_name.as_deref() else {
        return Ok(());
    };
    let db_path = app_data_dir.join(db_name);
    if !db_path.exists() {
        return Err(format!(
            "Rollback could not restore the previous database file '{}'",
            db_name
        ));
    }
    let conn = open_readonly(&db_path)?;
    verify_database_integrity(&conn)?;
    let schema_version = Database::schema_version(&conn)
        .map_err(|e| format!("Failed to read rolled-back schema version: {}", e))?;

    if let Some(expected) = pending.previous_record_count {
        let records = count_table(&conn, "records", schema_version, 1)?;
        if records != expected {
            return Err(format!(
                "Rollback verification failed: expected {} records, found {}",
                expected, records
            ));
        }
    }
    if let Some(expected) = pending.previous_attachment_count {
        let attachments = count_table(&conn, "attachments", schema_version, 3)?;
        if attachments != expected {
            return Err(format!(
                "Rollback verification failed: expected {} attachments, found {}",
                expected, attachments
            ));
        }
    }
    Ok(())
}

fn apply_files(
    app_data_dir: &Path,
    pending: &PendingRestore,
    staging_dir: &Path,
    recovery_dir: &Path,
    hook: Option<&dyn Fn(&str) -> Result<(), String>>,
) -> Result<(), String> {
    let call_hook = |phase: &str| -> Result<(), String> {
        if let Some(cb) = hook {
            cb(phase)?;
        }
        Ok(())
    };

    let before_swap = recovery_dir.join("active-before-swap");
    fs::create_dir_all(&before_swap)
        .map_err(|e| format!("Failed to create swap directory: {}", e))?;

    // Move the current database and any WAL/SHM sidecars out of the way. Moving
    // (rather than deleting) keeps them available for deterministic rollback.
    for name in ACTIVE_DB_FILE_NAMES {
        let active = app_data_dir.join(name);
        if active.exists() {
            move_any(&active, &before_swap.join(name))?;
        }
    }
    call_hook("after-active-database-moved")?;

    let active_attachments = app_data_dir.join("attachments");
    if active_attachments.exists() {
        move_any(&active_attachments, &before_swap.join("attachments"))?;
    }
    // Sentinel: marks that the attachment swap has started even if the previous
    // environment had no attachment directory. Rollback treats its presence as
    // "the active directory is now the restored one".
    fs::create_dir_all(before_swap.join("attachments"))
        .map_err(|e| format!("Failed to prepare attachment swap: {}", e))?;
    call_hook("after-active-attachments-moved")?;

    let staged_db = staging_dir.join(NDARCHIVE_DATABASE_PATH);
    if !staged_db.exists() {
        return Err("Staged database is missing; cannot complete restore".to_string());
    }
    move_any(&staged_db, &app_data_dir.join("dace.db"))?;
    call_hook("after-database-installed")?;

    let staged_attachments = staging_dir.join("attachments");
    let target_attachments = app_data_dir.join("attachments");
    if staged_attachments.exists() {
        move_any(&staged_attachments, &target_attachments)?;
    } else {
        fs::create_dir_all(&target_attachments)
            .map_err(|e| format!("Failed to create restored attachment directory: {}", e))?;
    }
    call_hook("after-attachments-installed")?;

    // Defensive: never allow stale WAL/SHM from the previous environment to
    // remain beside the restored database file.
    for name in ["dace.db-wal", "dace.db-shm", "novadome.db-wal", "novadome.db-shm"] {
        let stale = app_data_dir.join(name);
        if stale.exists() {
            remove_any(&stale)?;
        }
    }

    verify_installed_environment(app_data_dir, pending)?;

    // The verification connection may create transient WAL/SHM files even in
    // read-only mode. The restored database file is a complete snapshot, so no
    // sidecars should survive into the running application.
    for name in ACTIVE_DB_FILE_NAMES {
        if name.ends_with("-wal") || name.ends_with("-shm") {
            let path = app_data_dir.join(name);
            if path.exists() {
                remove_any(&path)?;
            }
        }
    }

    call_hook("before-verified")?;
    Ok(())
}

fn success_outcome(
    pending: &PendingRestore,
    recovery_dir: &Path,
) -> RestoreOutcome {
    RestoreOutcome {
        success: true,
        message: format!(
            "Restore completed: {} records and {} managed attachments restored and verified.",
            pending.record_count, pending.attachment_count
        ),
        archive_path: Some(pending.archive_path.clone()),
        record_count: Some(pending.record_count),
        attachment_count: Some(pending.attachment_count),
        recovery_dir: Some(recovery_dir.to_string_lossy().to_string()),
        completed_at: now_rfc3339(),
    }
}

fn failure_outcome(
    pending: &PendingRestore,
    recovery_dir: &Path,
    message: String,
) -> RestoreOutcome {
    RestoreOutcome {
        success: false,
        message,
        archive_path: Some(pending.archive_path.clone()),
        record_count: None,
        attachment_count: None,
        recovery_dir: Some(recovery_dir.to_string_lossy().to_string()),
        completed_at: now_rfc3339(),
    }
}

fn cleanup_stale_staging(app_data_dir: &Path) {
    let staging_root = app_data_dir.join(RESTORE_STAGING_DIR);
    if let Ok(entries) = fs::read_dir(&staging_root) {
        for entry in entries.flatten() {
            let _ = remove_any(&entry.path());
        }
    }
}

fn cleanup_old_recovery_snapshots(app_data_dir: &Path, keep: usize) {
    let root = app_data_dir.join(RESTORE_RECOVERY_DIR);
    let Ok(entries) = fs::read_dir(&root) else {
        return;
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|entry| entry.path())
        .collect();
    // Timestamp-prefixed names sort chronologically.
    dirs.sort();
    let remove_count = dirs.len().saturating_sub(keep);
    for path in dirs.into_iter().take(remove_count) {
        let _ = fs::remove_dir_all(path);
    }
}

/// Applies a pending restore. Called during startup before SQLite/attachment
/// handles are opened. Also finalizes an interrupted previous attempt or rolls
/// it back. Returns the outcome that should be surfaced to the user after the
/// app UI loads.
pub fn apply_pending_restore(app_data_dir: &Path) -> Result<Option<RestoreOutcome>, String> {
    apply_pending_restore_with_hook(app_data_dir, None)
}

pub(crate) fn apply_pending_restore_with_hook(
    app_data_dir: &Path,
    hook: Option<&dyn Fn(&str) -> Result<(), String>>,
) -> Result<Option<RestoreOutcome>, String> {
    let marker_path = app_data_dir.join(RESTORE_MARKER_FILE);
    if !marker_path.exists() {
        cleanup_stale_staging(app_data_dir);
        cleanup_old_recovery_snapshots(app_data_dir, KEEP_RECOVERY_SNAPSHOTS);
        return Ok(None);
    }

    let mut pending: PendingRestore = read_json(&marker_path)?;
    if pending.marker_version != MARKER_VERSION {
        return Err(format!(
            "Pending restore marker version {} is not supported",
            pending.marker_version
        ));
    }

    let staging_dir = safe_join(app_data_dir, &pending.staging_dir)?;
    let recovery_dir = safe_join(app_data_dir, &pending.recovery_dir)?;
    let result_path = app_data_dir.join(RESTORE_RESULT_FILE);

    if pending.phase == PHASE_VERIFIED {
        let outcome = success_outcome(&pending, &recovery_dir);
        write_json_atomic(&result_path, &outcome)?;
        let _ = fs::remove_dir_all(&staging_dir);
        let _ = fs::remove_file(&marker_path);
        cleanup_old_recovery_snapshots(app_data_dir, KEEP_RECOVERY_SNAPSHOTS);
        return Ok(Some(outcome));
    }

    if pending.phase == PHASE_APPLYING {
        let rollback = rollback_restore(app_data_dir, &pending, &staging_dir, &recovery_dir);
        let outcome = match rollback {
            Ok(()) => failure_outcome(
                &pending,
                &recovery_dir,
                "A previous restore was interrupted while replacing data. Dace rolled back to your previous data using the recovery snapshot.".to_string(),
            ),
            Err(err) => failure_outcome(
                &pending,
                &recovery_dir,
                format!(
                    "CRITICAL: a previous restore was interrupted and automatic rollback failed ({}). Your recovery snapshot is preserved at {}.",
                    err,
                    recovery_dir.to_string_lossy()
                ),
            ),
        };
        write_json_atomic(&result_path, &outcome)?;
        if outcome.message.starts_with("CRITICAL") {
            let failed_marker = app_data_dir.join(RESTORE_FAILED_MARKER_FILE);
            let _ = fs::rename(&marker_path, &failed_marker);
        } else {
            let _ = fs::remove_file(&marker_path);
            cleanup_stale_staging(app_data_dir);
        }
        return Ok(Some(outcome));
    }

    if pending.phase != PHASE_PREPARED {
        return Err(format!(
            "Pending restore marker has an unknown phase: {}",
            pending.phase
        ));
    }

    pending.phase = PHASE_APPLYING.to_string();
    write_json_atomic(&marker_path, &pending)?;

    match apply_files(app_data_dir, &pending, &staging_dir, &recovery_dir, hook) {
        Ok(()) => {
            pending.phase = PHASE_VERIFIED.to_string();
            write_json_atomic(&marker_path, &pending)?;
            let outcome = success_outcome(&pending, &recovery_dir);
            write_json_atomic(&result_path, &outcome)?;
            let _ = fs::remove_dir_all(&staging_dir);
            let _ = fs::remove_file(&marker_path);
            cleanup_old_recovery_snapshots(app_data_dir, KEEP_RECOVERY_SNAPSHOTS);
            Ok(Some(outcome))
        }
        Err(apply_err) => {
            let rollback = rollback_restore(app_data_dir, &pending, &staging_dir, &recovery_dir);
            let outcome = match rollback {
                Ok(()) => failure_outcome(
                    &pending,
                    &recovery_dir,
                    format!(
                        "Restore failed and was rolled back. Your previous data is intact. Cause: {}",
                        apply_err
                    ),
                ),
                Err(rollback_err) => failure_outcome(
                    &pending,
                    &recovery_dir,
                    format!(
                        "CRITICAL: restore failed ({}) and automatic rollback also failed ({}). Your previous data is preserved in the recovery snapshot at {}.",
                        apply_err,
                        rollback_err,
                        recovery_dir.to_string_lossy()
                    ),
                ),
            };
            write_json_atomic(&result_path, &outcome)?;
            if outcome.message.starts_with("CRITICAL") {
                let failed_marker = app_data_dir.join(RESTORE_FAILED_MARKER_FILE);
                let _ = fs::rename(&marker_path, &failed_marker);
            } else {
                let _ = fs::remove_file(&marker_path);
                cleanup_stale_staging(app_data_dir);
            }
            Ok(Some(outcome))
        }
    }
}

/// Returns and consumes the outcome of the most recent restore so the UI can
/// report it exactly once after the restart.
pub fn take_restore_result(app_data_dir: &Path) -> Result<Option<RestoreOutcome>, String> {
    let result_path = app_data_dir.join(RESTORE_RESULT_FILE);
    if !result_path.exists() {
        return Ok(None);
    }
    let outcome: RestoreOutcome = read_json(&result_path)?;
    let _ = fs::remove_file(&result_path);
    Ok(Some(outcome))
}

/// Re-verifies a successful restore with the live handles opened during startup.
/// The UI consumes the result file only after this runs, so a success notice is
/// never shown for a database/storage environment that failed to open.
pub fn confirm_startup_restore(
    app_data_dir: &Path,
    database: &Database,
    storage: &AttachmentStorage,
) -> Result<(), String> {
    let result_path = app_data_dir.join(RESTORE_RESULT_FILE);
    if !result_path.exists() {
        return Ok(());
    }
    let mut outcome: RestoreOutcome = read_json(&result_path)?;
    if !outcome.success {
        return Ok(());
    }

    let verification = (|| -> Result<(), String> {
        let conn = database
            .conn
            .lock()
            .map_err(|e| format!("Failed to lock restored database: {}", e))?;
        verify_database_integrity(&conn)?;
        let schema_version = Database::schema_version(&conn)
            .map_err(|e| format!("Failed to read restored schema version: {}", e))?;
        check_required_tables(&conn, schema_version)?;

        if let Some(expected) = outcome.record_count {
            let records = count_table(&conn, "records", schema_version, 1)?;
            if records != expected {
                return Err(format!(
                    "Startup verification found {} records, expected {}",
                    records, expected
                ));
            }
        }
        if let Some(expected) = outcome.attachment_count {
            let attachments = count_table(&conn, "attachments", schema_version, 3)?;
            if attachments != expected {
                return Err(format!(
                    "Startup verification found {} attachments, expected {}",
                    attachments, expected
                ));
            }
        }

        for row in read_attachment_rows(&conn)? {
            let relative = sanitize_archive_path(&row.storage_path)?;
            let path = storage
                .resolve_path(&relative)
                .map_err(|e| format!("Restored attachment '{}' could not be resolved: {}", row.file_name, e))?;
            let (hash, size) = sha256_file(&path).map_err(|e| {
                format!(
                    "Restored attachment '{}' could not be verified: {}",
                    row.file_name, e
                )
            })?;
            if size != row.file_size.max(0) as u64 || !hash.eq_ignore_ascii_case(&row.sha256_hash) {
                return Err(format!(
                    "Restored attachment '{}' failed startup checksum verification",
                    row.file_name
                ));
            }
        }
        Ok(())
    })();

    if let Err(err) = verification {
        outcome.success = false;
        outcome.message = format!(
            "CRITICAL: restore data failed verification after startup ({}). Your recovery snapshot is preserved at {}.",
            err,
            outcome
                .recovery_dir
                .clone()
                .unwrap_or_else(|| app_data_dir.join(RESTORE_RECOVERY_DIR).to_string_lossy().to_string())
        );
        outcome.record_count = None;
        outcome.attachment_count = None;
    } else {
        outcome.message = format!(
            "Restore completed and verified at startup: {} records and {} managed attachments.",
            outcome.record_count.unwrap_or(0),
            outcome.attachment_count.unwrap_or(0)
        );
    }
    outcome.completed_at = now_rfc3339();
    write_json_atomic(&result_path, &outcome)
}
