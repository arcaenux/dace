use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::attachments::storage::AttachmentStorage;
use crate::db::Database;

use super::archive::{
    write_backup, ArchiveFile, AttachmentEntry, BackupManifest, BackupTotals, DatabaseEntry,
    validate_backup, BACKUP_FORMAT_VERSION, BACKUP_MAGIC, LEGACY_BACKUP_FORMAT, LEGACY_BACKUP_MAGIC,
};
use super::restore::{
    apply_pending_restore, apply_pending_restore_with_hook, confirm_startup_restore,
    inspect_archive, inspect_archive_with_progress, prepare_restore, prepare_restore_checked,
    record_startup_restore_error, snapshot_archive,
    take_restore_result, RestoreOutcome, RESTORE_FAILED_MARKER_FILE, RESTORE_MARKER_FILE,
    RESTORE_RECOVERY_DIR, RESTORE_RESULT_FILE, RESTORE_STAGING_DIR,
};
use super::service::create_backup_with_progress;

struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!("dace-{}-{}", prefix, Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[derive(Debug, Clone)]
struct SeedInfo {
    relative_path: String,
    data: Vec<u8>,
    hash: String,
}

fn sha256_hex_bytes(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

fn insert_record(conn: &Connection, id: &str, title: &str, content: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO records (id, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, title, content, now, now],
    )
    .expect("insert record");
}

fn insert_managed_attachment(
    conn: &Connection,
    attachments_dir: &Path,
    id: &str,
    file_name: &str,
    data: &[u8],
) -> SeedInfo {
    let hash = sha256_hex_bytes(data);
    let relative = format!("{}/{}.txt", &hash[..2], hash);
    let full = attachments_dir.join(&relative);
    fs::create_dir_all(full.parent().expect("attachment parent")).expect("create shard");
    fs::write(&full, data).expect("write attachment");
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO attachments (id, file_name, mime_type, file_size, sha256_hash, storage_path, created_at, updated_at)
         VALUES (?1, ?2, 'text/plain', ?3, ?4, ?5, ?6, ?7)",
        params![id, file_name, data.len() as i64, hash, relative, now, now],
    )
    .expect("insert attachment");
    SeedInfo {
        relative_path: relative,
        data: data.to_vec(),
        hash,
    }
}

fn seed_rich_environment(db: &Database, attachments_dir: &Path) -> SeedInfo {
    let attachments_dir = attachments_dir.to_path_buf();
    let conn = db.conn.lock().expect("lock db");
    let now = chrono::Utc::now().to_rfc3339();

    insert_record(&conn, "rec-1", "Quantum Notes", "Entanglement summary");
    insert_record(&conn, "rec-2", "Field Report", "Observations from the archive");

    conn.execute(
        "INSERT INTO tags (id, name, created_at) VALUES ('tag-1', 'Research', ?1)",
        params![now],
    )
    .expect("insert tag");
    conn.execute(
        "INSERT INTO record_tags (record_id, tag_id) VALUES ('rec-1', 'tag-1')",
        [],
    )
    .expect("link tag");

    conn.execute(
        "INSERT INTO record_relationships (id, source_id, target_id, relation_type, description, created_at)
         VALUES ('rel-1', 'rec-1', 'rec-2', 'supports', 'Primary support', ?1)",
        params![now],
    )
    .expect("insert relationship");

    let seed = insert_managed_attachment(
        &conn,
        &attachments_dir,
        "att-1",
        "document.txt",
        b"Dace restored research document payload",
    );

    conn.execute(
        "INSERT INTO record_attachments (record_id, attachment_id, created_at) VALUES ('rec-1', 'att-1', ?1)",
        params![now],
    )
    .expect("link attachment");

    conn.execute(
        "INSERT INTO highlights (id, attachment_id, doc_sha256, page_number, selected_text, anchor_data, highlight_type, color, created_at, updated_at)
         VALUES ('hl-1', 'att-1', ?1, 1, 'selected passage', '{\"page\":1}', 'important', '#ffee55', ?2, ?2)",
        params![seed.hash, now],
    )
    .expect("insert highlight");
    conn.execute(
        "INSERT INTO annotations (id, highlight_id, content, created_at, updated_at)
         VALUES ('an-1', 'hl-1', 'My annotation', ?1, ?1)",
        params![now],
    )
    .expect("insert annotation");
    conn.execute(
        "INSERT INTO highlight_records (highlight_id, record_id, commentary, created_at)
         VALUES ('hl-1', 'rec-1', 'Excerpt commentary', ?1)",
        params![now],
    )
    .expect("link highlight");

    seed
}

fn create_rich_archive(source: &Path) -> (PathBuf, SeedInfo) {
    let db_path = source.join("dace.db");
    let attachments_dir = source.join("attachments");
    let db = Database::init(&db_path).expect("init source db");
    let storage = AttachmentStorage::new(&attachments_dir).expect("init source storage");
    let seed = seed_rich_environment(&db, &attachments_dir);
    let archive = source.join("rich.dacebackup");
    create_backup_with_progress(&db, &storage, &archive, None).expect("create rich backup");
    drop(storage);
    drop(db);
    (archive, seed)
}

fn create_current_environment(app: &Path) -> (PathBuf, SeedInfo) {
    let db_path = app.join("dace.db");
    let attachments_dir = app.join("attachments");
    let db = Database::init(&db_path).expect("init current db");
    let _storage = AttachmentStorage::new(&attachments_dir).expect("init current storage");
    let seed = {
        let conn = db.conn.lock().expect("lock current db");
        insert_record(&conn, "current-record", "Current Only", "Must survive rollback");
        insert_managed_attachment(
            &conn,
            &attachments_dir,
            "current-att",
            "current.txt",
            b"current-only attachment bytes",
        )
    };
    drop(db);
    (db_path, seed)
}

fn make_manifest(db_bytes: &[u8], attachments: Vec<AttachmentEntry>) -> BackupManifest {
    let database_bytes = db_bytes.len() as u64;
    let attachment_bytes: u64 = attachments.iter().map(|a| a.size).sum();
    BackupManifest {
        format: "dace-backup".to_string(),
        format_version: BACKUP_FORMAT_VERSION,
        app_version: "0.1.0".to_string(),
        schema_version: 4,
        created_at: chrono::Utc::now().to_rfc3339(),
        database: DatabaseEntry {
            archive_path: "database/dace.db".to_string(),
            source_name: "dace.db".to_string(),
            size: database_bytes,
            sha256: sha256_hex_bytes(db_bytes),
        },
        totals: BackupTotals {
            attachment_count: attachments.len(),
            attachment_bytes,
            database_bytes,
            total_bytes: database_bytes + attachment_bytes,
        },
        attachments,
    }
}

fn attachment_entry(relative: &str, bytes: &[u8], id: &str) -> AttachmentEntry {
    let hash = sha256_hex_bytes(bytes);
    AttachmentEntry {
        archive_path: format!("attachments/{}", relative),
        relative_path: relative.to_string(),
        file_name: "file.txt".to_string(),
        mime_type: "text/plain".to_string(),
        db_file_size: bytes.len() as i64,
        sha256: hash,
        size: bytes.len() as u64,
        attachment_id: id.to_string(),
    }
}

fn write_payload(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create payload dir");
    }
    fs::write(&path, bytes).expect("write payload");
    path
}

fn archive_file(archive_path: &str, source: PathBuf, sha: String, size: u64) -> ArchiveFile {
    ArchiveFile {
        archive_path: archive_path.to_string(),
        source_path: source,
        sha256_hex: sha,
        size,
    }
}

fn record_count(app: &Path) -> i64 {
    let conn = Connection::open(app.join("dace.db")).expect("open restored db");
    conn.query_row("SELECT COUNT(*) FROM records", [], |row| row.get(0))
        .expect("count records")
}

fn table_count(app: &Path, table: &str) -> i64 {
    let conn = Connection::open(app.join("dace.db")).expect("open db");
    conn.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |row| row.get(0))
        .expect("count table")
}

fn first_recovery_dir(app: &Path) -> PathBuf {
    let root = app.join(RESTORE_RECOVERY_DIR);
    fs::read_dir(&root)
        .expect("read recovery root")
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.is_dir())
        .expect("recovery snapshot directory")
}

fn assert_no_staging_entries(app: &Path) {
    let staging = app.join(RESTORE_STAGING_DIR);
    if staging.exists() {
        assert!(
            fs::read_dir(&staging).expect("read staging").next().is_none(),
            "staging must be empty"
        );
    }
}

#[test]
fn test_restore_round_trip_preserves_all_records_relationships_attachments_highlights_and_annotations() {
    let source = TempDirGuard::new("restore-rich-source");
    let (archive, seed) = create_rich_archive(source.path());

    let app = TempDirGuard::new("restore-rich-app");
    let (current_db, current_seed) = create_current_environment(app.path());
    assert_eq!(record_count(app.path()), 1);

    let preview = inspect_archive(&archive).expect("inspect valid archive");
    assert_eq!(preview.validation_status, "valid");
    assert_eq!(preview.record_count, 2);
    assert_eq!(preview.tag_count, 1);
    assert_eq!(preview.relationship_count, 1);
    assert_eq!(preview.attachment_count, 1);
    assert_eq!(preview.highlight_count, 1);
    assert_eq!(preview.annotation_count, 1);
    assert_eq!(preview.schema_version, crate::db::SCHEMA_VERSION);
    assert!(preview.archive_size > 0);
    assert!(!app.path().join(RESTORE_MARKER_FILE).exists(), "inspection must not write live state");

    let start = prepare_restore(app.path(), &archive, Some(&current_db), None).expect("prepare restore");
    assert!(start.restart_required);
    assert!(app.path().join(RESTORE_MARKER_FILE).exists(), "pending marker must be written");
    assert_eq!(record_count(app.path()), 1, "preparation must not modify live data");

    let outcome = apply_pending_restore(app.path())
        .expect("apply pending restore")
        .expect("outcome");
    assert!(outcome.success, "{}", outcome.message);
    assert!(!app.path().join(RESTORE_MARKER_FILE).exists());

    let db = Database::init(app.path().join("dace.db")).expect("open restored database");
    {
        let conn = db.conn.lock().expect("lock restored db");
        let titles: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT title FROM records ORDER BY id")
                .expect("prepare records");
            stmt.query_map([], |row| row.get(0))
                .expect("query records")
                .collect::<Result<Vec<_>, _>>()
                .expect("collect records")
        };
        assert_eq!(titles, vec!["Quantum Notes", "Field Report"]);
        let current: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM records WHERE id='current-record'",
                [],
                |row| row.get(0),
            )
            .expect("count current");
        assert_eq!(current, 0, "previous environment must be fully replaced");

        let relationships: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM record_relationships WHERE id='rel-1' AND relation_type='supports'",
                [],
                |row| row.get(0),
            )
            .expect("relationship");
        assert_eq!(relationships, 1);

        let tag_links: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM record_tags WHERE record_id='rec-1' AND tag_id='tag-1'",
                [],
                |row| row.get(0),
            )
            .expect("tag link");
        assert_eq!(tag_links, 1);

        let record_attachments: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM record_attachments WHERE record_id='rec-1' AND attachment_id='att-1'",
                [],
                |row| row.get(0),
            )
            .expect("record attachment");
        assert_eq!(record_attachments, 1);

        let highlight_text: String = conn
            .query_row(
                "SELECT selected_text FROM highlights WHERE id='hl-1' AND attachment_id='att-1'",
                [],
                |row| row.get(0),
            )
            .expect("highlight");
        assert_eq!(highlight_text, "selected passage");

        let annotation: String = conn
            .query_row(
                "SELECT content FROM annotations WHERE id='an-1' AND highlight_id='hl-1'",
                [],
                |row| row.get(0),
            )
            .expect("annotation");
        assert_eq!(annotation, "My annotation");

        let excerpt_links: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM highlight_records WHERE highlight_id='hl-1' AND record_id='rec-1'",
                [],
                |row| row.get(0),
            )
            .expect("highlight record");
        assert_eq!(excerpt_links, 1);
    }
    drop(db);

    let restored_file = app.path().join("attachments").join(&seed.relative_path);
    assert_eq!(fs::read(&restored_file).expect("read restored attachment"), seed.data);
    assert_eq!(sha256_hex_bytes(&fs::read(&restored_file).unwrap()), seed.hash);
    assert!(
        !app.path().join("attachments").join(&current_seed.relative_path).exists(),
        "previous attachments must not remain in the restored environment"
    );

    let recovery = first_recovery_dir(app.path());
    let snapshot = recovery.join("database-snapshot").join("dace.db");
    assert!(snapshot.exists(), "recovery database snapshot must be preserved");
    assert!(recovery.join("active-before-swap").exists());
    assert!(recovery.join("metadata.json").exists());
    let snap = Connection::open(snapshot).expect("open snapshot");
    let snap_current: i64 = snap
        .query_row(
            "SELECT COUNT(*) FROM records WHERE id='current-record'",
            [],
            |row| row.get(0),
        )
        .expect("snapshot current record");
    assert_eq!(snap_current, 1, "recovery snapshot must contain the previous database");
    assert!(
        recovery
            .join("attachments")
            .join(&current_seed.relative_path)
            .exists(),
        "recovery snapshot must contain the previous attachments"
    );

    let result = take_restore_result(app.path())
        .expect("read result")
        .expect("result should exist");
    assert!(result.success);
    assert_eq!(result.record_count, Some(2));
    assert_eq!(result.attachment_count, Some(1));
    assert!(take_restore_result(app.path()).unwrap().is_none(), "result is consumed once");
}

#[test]
fn test_restore_empty_database_replaces_existing_data() {
    let source = TempDirGuard::new("restore-empty-source");
    let source_db = source.path().join("dace.db");
    let source_storage = source.path().join("attachments");
    let db = Database::init(&source_db).expect("init empty db");
    let storage = AttachmentStorage::new(&source_storage).expect("init storage");
    let archive = source.path().join("empty.dacebackup");
    create_backup_with_progress(&db, &storage, &archive, None).expect("empty backup");
    drop(storage);
    drop(db);

    let app = TempDirGuard::new("restore-empty-app");
    let (current_db, _) = create_current_environment(app.path());
    assert_eq!(record_count(app.path()), 1);

    prepare_restore(app.path(), &archive, Some(&current_db), None).expect("prepare empty restore");
    let outcome = apply_pending_restore(app.path()).unwrap().unwrap();
    assert!(outcome.success, "{}", outcome.message);
    assert_eq!(record_count(app.path()), 0);
    assert_eq!(table_count(app.path(), "attachments"), 0);
}

#[test]
fn test_restore_large_attachment() {
    let source = TempDirGuard::new("restore-large-source");
    let db = Database::init(source.path().join("dace.db")).expect("init db");
    let attachments_dir = source.path().join("attachments");
    let storage = AttachmentStorage::new(&attachments_dir).expect("init storage");

    let mut data = Vec::with_capacity(8 * 1024 * 1024);
    for i in 0..(8 * 1024 * 1024) {
        data.push((i % 251) as u8);
    }
    let seed = {
        let conn = db.conn.lock().expect("lock");
        insert_record(&conn, "large-record", "Large", "payload");
        insert_managed_attachment(&conn, &attachments_dir, "large-att", "large.bin", &data)
    };
    let archive = source.path().join("large.dacebackup");
    create_backup_with_progress(&db, &storage, &archive, None).expect("large backup");
    drop(storage);
    drop(db);

    let app = TempDirGuard::new("restore-large-app");
    prepare_restore(app.path(), &archive, None, None).expect("prepare large restore");
    let outcome = apply_pending_restore(app.path()).unwrap().unwrap();
    assert!(outcome.success, "{}", outcome.message);

    let restored = app.path().join("attachments").join(&seed.relative_path);
    let restored_bytes = fs::read(&restored).expect("read restored large attachment");
    assert_eq!(restored_bytes.len(), data.len());
    assert_eq!(sha256_hex_bytes(&restored_bytes), seed.hash);
}

#[test]
fn test_inspect_rejects_invalid_archive() {
    let temp = TempDirGuard::new("restore-invalid");
    let archive = temp.path().join("garbage.dacebackup");
    fs::write(&archive, b"this is definitely not a Dace backup").expect("write garbage");
    let err = inspect_archive(&archive).expect_err("invalid archive must be rejected");
    assert!(
        err.to_lowercase().contains("magic") || err.to_lowercase().contains("header"),
        "unexpected error: {}",
        err
    );
}

#[test]
fn test_inspect_rejects_unsupported_format_version() {
    let temp = TempDirGuard::new("restore-version");
    let archive = temp.path().join("future.dacebackup");
    {
        let mut file = File::create(&archive).expect("create");
        file.write_all(BACKUP_MAGIC).unwrap();
        file.write_all(&2u32.to_le_bytes()).unwrap();
        file.write_all(&0u64.to_le_bytes()).unwrap();
    }
    let err = inspect_archive(&archive).expect_err("newer format must be rejected");
    assert!(
        err.to_lowercase().contains("unsupported") && err.contains('2'),
        "unexpected error: {}",
        err
    );
}

#[test]
fn test_legacy_ndarchive_backups_still_validate() {
    // Backups made before the Dace rename carry the old header and format
    // name; they must keep restoring.
    let temp = TempDirGuard::new("restore-legacy");
    let db = b"legacy database bytes".to_vec();
    let mut manifest = make_manifest(&db, Vec::new());
    manifest.format = LEGACY_BACKUP_FORMAT.to_string();
    let payload = write_payload(temp.path(), "payload/db", &db);
    let archive = temp.path().join("old-library.ndarchive");
    write_backup(
        &archive,
        &manifest,
        &[archive_file(
            "database/dace.db",
            payload,
            manifest.database.sha256.clone(),
            db.len() as u64,
        )],
    )
    .expect("write archive");
    let mut bytes = fs::read(&archive).expect("read archive");
    assert_eq!(&bytes[..14], BACKUP_MAGIC, "new backups use the Dace header");
    bytes[..14].copy_from_slice(LEGACY_BACKUP_MAGIC);
    fs::write(&archive, &bytes).expect("rewrite header");

    let read = validate_backup(&archive).expect("legacy backup must still validate");
    assert_eq!(read.format, LEGACY_BACKUP_FORMAT);
}

#[test]
fn test_inspect_rejects_corrupted_database() {
    let temp = TempDirGuard::new("restore-corrupt-db");
    let fake_db = b"not a sqlite database at all".to_vec();
    let manifest = make_manifest(&fake_db, Vec::new());
    let db_payload = write_payload(temp.path(), "payload/db", &fake_db);
    let archive = temp.path().join("corrupt-db.dacebackup");
    write_backup(
        &archive,
        &manifest,
        &[archive_file(
            "database/dace.db",
            db_payload,
            manifest.database.sha256.clone(),
            fake_db.len() as u64,
        )],
    )
    .expect("write archive");

    let err = inspect_archive(&archive).expect_err("corrupt database must be rejected");
    let lower = err.to_lowercase();
    assert!(
        lower.contains("integrity") || lower.contains("not a database") || lower.contains("malformed"),
        "unexpected error: {}",
        err
    );
}

#[test]
fn test_inspect_rejects_missing_attachment_entry() {
    let temp = TempDirGuard::new("restore-missing-att");
    let fake_db = b"placeholder".to_vec();
    let missing_bytes = b"attachment that is not in the archive".to_vec();
    let manifest = make_manifest(
        &fake_db,
        vec![attachment_entry("aa/missing.txt", &missing_bytes, "att-missing")],
    );
    let db_payload = write_payload(temp.path(), "payload/db", &fake_db);
    let archive = temp.path().join("missing-att.dacebackup");
    write_backup(
        &archive,
        &manifest,
        &[archive_file(
            "database/dace.db",
            db_payload,
            manifest.database.sha256.clone(),
            fake_db.len() as u64,
        )],
    )
    .expect("write archive");

    let err = inspect_archive(&archive).expect_err("missing attachment must be rejected");
    assert!(err.to_lowercase().contains("missing"), "unexpected error: {}", err);
}

#[test]
fn test_inspect_rejects_checksum_mismatch() {
    let temp = TempDirGuard::new("restore-checksum");
    let db_bytes = b"payload with a deliberately wrong hash".to_vec();
    let wrong_hash = "0".repeat(64);
    let mut manifest = make_manifest(&db_bytes, Vec::new());
    manifest.database.sha256 = wrong_hash.clone();
    let db_payload = write_payload(temp.path(), "payload/db", &db_bytes);
    let archive = temp.path().join("checksum.dacebackup");
    write_backup(
        &archive,
        &manifest,
        &[archive_file(
            "database/dace.db",
            db_payload,
            wrong_hash,
            db_bytes.len() as u64,
        )],
    )
    .expect("write archive");

    let err = inspect_archive(&archive).expect_err("checksum mismatch must be rejected");
    assert!(err.to_lowercase().contains("checksum"), "unexpected error: {}", err);
}

#[test]
fn test_inspect_rejects_path_traversal_in_manifest() {
    let temp = TempDirGuard::new("restore-traversal");
    let db_bytes = b"placeholder".to_vec();
    let mut manifest = make_manifest(&db_bytes, Vec::new());
    let mut entry = attachment_entry("aa/safe.txt", b"x", "att-evil");
    entry.archive_path = "attachments/../evil.txt".to_string();
    entry.relative_path = "../evil.txt".to_string();
    manifest.attachments.push(entry);
    manifest.totals.attachment_count = 1;
    manifest.totals.attachment_bytes = 1;
    manifest.totals.total_bytes = manifest.totals.database_bytes + 1;

    let archive = temp.path().join("traversal.dacebackup");
    write_backup(&archive, &manifest, &[]).expect("write manifest-only archive");
    let err = inspect_archive(&archive).expect_err("traversal path must be rejected");
    assert!(
        err.to_lowercase().contains("unsafe") || err.to_lowercase().contains("traversal"),
        "unexpected error: {}",
        err
    );
}

#[test]
fn test_inspect_rejects_duplicate_manifest_paths() {
    let temp = TempDirGuard::new("restore-duplicate");
    let db_bytes = b"placeholder".to_vec();
    let bytes = b"duplicate".to_vec();
    let first = attachment_entry("aa/duplicate.txt", &bytes, "att-1");
    let second = attachment_entry("aa/duplicate.txt", &bytes, "att-2");
    let manifest = make_manifest(&db_bytes, vec![first, second]);
    let archive = temp.path().join("duplicate.dacebackup");
    write_backup(&archive, &manifest, &[]).expect("write manifest-only archive");
    let err = inspect_archive(&archive).expect_err("duplicate entries must be rejected");
    assert!(err.to_lowercase().contains("duplicate"), "unexpected error: {}", err);
}

#[test]
fn test_failed_preparation_leaves_live_data_untouched() {
    let temp = TempDirGuard::new("restore-fail-prepare");
    let app = TempDirGuard::new("restore-fail-prepare-app");
    let (current_db, current_seed) = create_current_environment(app.path());

    let invalid = temp.path().join("bad.dacebackup");
    fs::write(&invalid, b"not an archive").expect("write invalid");

    let err = prepare_restore(app.path(), &invalid, Some(&current_db), None)
        .expect_err("invalid archive must fail preparation");
    assert!(!err.is_empty());

    assert!(!app.path().join(RESTORE_MARKER_FILE).exists(), "no marker on failed preparation");
    assert_eq!(record_count(app.path()), 1, "live data must be untouched");
    assert!(
        app.path()
            .join("attachments")
            .join(&current_seed.relative_path)
            .exists(),
        "live attachments must be untouched"
    );
    let staging = app.path().join(RESTORE_STAGING_DIR);
    if staging.exists() {
        assert!(
            fs::read_dir(&staging).expect("read staging").next().is_none(),
            "failed preparation must not leave staging data"
        );
    }
    assert!(!app.path().join(RESTORE_RESULT_FILE).exists());
}

#[test]
fn test_prepare_blocks_second_restore_while_one_is_pending() {
    let source = TempDirGuard::new("restore-pending-source");
    let (archive, _) = create_rich_archive(source.path());
    let app = TempDirGuard::new("restore-pending-app");
    let (current_db, _) = create_current_environment(app.path());

    prepare_restore(app.path(), &archive, Some(&current_db), None).expect("first prepare");
    let err = prepare_restore(app.path(), &archive, Some(&current_db), None)
        .expect_err("second prepare must be blocked");
    assert!(err.to_lowercase().contains("already pending"), "unexpected error: {}", err);
    let _ = fs::remove_file(app.path().join(RESTORE_MARKER_FILE));
    let _ = fs::remove_dir_all(app.path().join(RESTORE_STAGING_DIR));
    let _ = fs::remove_dir_all(app.path().join(RESTORE_RECOVERY_DIR));
}

#[test]
fn test_failure_during_replacement_rolls_back_and_preserves_recovery_snapshot() {
    let source = TempDirGuard::new("restore-swap-fail-source");
    let (archive, _) = create_rich_archive(source.path());
    let app = TempDirGuard::new("restore-swap-fail-app");
    let (current_db, current_seed) = create_current_environment(app.path());

    prepare_restore(app.path(), &archive, Some(&current_db), None).expect("prepare restore");

    let hook = |phase: &str| -> Result<(), String> {
        if phase == "after-database-installed" {
            Err("simulated failure while replacing data".to_string())
        } else {
            Ok(())
        }
    };
    let outcome = apply_pending_restore_with_hook(app.path(), Some(&hook))
        .unwrap()
        .expect("outcome");
    assert!(!outcome.success, "restore must report failure");
    assert!(
        outcome.message.to_lowercase().contains("rolled back"),
        "failure must be reported honestly: {}",
        outcome.message
    );

    assert!(!app.path().join(RESTORE_MARKER_FILE).exists(), "marker cleared after rollback");
    assert_eq!(record_count(app.path()), 1, "previous database must be restored");
    let conn = Connection::open(app.path().join("dace.db")).expect("open rolled-back db");
    let restored_recovered: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM records WHERE id='current-record'",
            [],
            |row| row.get(0),
        )
        .expect("count current record");
    assert_eq!(restored_recovered, 1);
    let archived_rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM records WHERE id IN ('rec-1','rec-2')",
            [],
            |row| row.get(0),
        )
        .expect("count archived rows");
    assert_eq!(archived_rows, 0, "partial restored data must not survive");
    assert!(
        app.path()
            .join("attachments")
            .join(&current_seed.relative_path)
            .exists(),
        "previous attachments must be restored"
    );

    let recovery = first_recovery_dir(app.path());
    assert!(
        recovery.join("active-before-swap").exists(),
        "rollback must preserve its swap workspace"
    );
    let snapshot = recovery.join("database-snapshot").join("dace.db");
    assert!(snapshot.exists(), "recovery snapshot must be preserved");
    let snap = Connection::open(snapshot).expect("open recovery snapshot");
    let snapshot_current: i64 = snap
        .query_row(
            "SELECT COUNT(*) FROM records WHERE id='current-record'",
            [],
            |row| row.get(0),
        )
        .expect("count snapshot record");
    assert_eq!(
        snapshot_current, 1,
        "recovery snapshot must retain the previous database"
    );
    let result = take_restore_result(app.path()).unwrap().expect("result");
    assert!(!result.success);
}

#[test]
fn test_interrupted_replacement_is_rolled_back_on_next_startup() {
    let source = TempDirGuard::new("restore-interrupt-source");
    let (archive, _) = create_rich_archive(source.path());
    let app = TempDirGuard::new("restore-interrupt-app");
    let (current_db, current_seed) = create_current_environment(app.path());

    prepare_restore(app.path(), &archive, Some(&current_db), None).expect("prepare restore");

    // Simulate a crash in the middle of the swap: mark the marker as applying,
    // move the original database aside, and install the staged database.
    let marker_path = app.path().join(RESTORE_MARKER_FILE);
    let raw = fs::read_to_string(&marker_path).expect("read marker");
    let mut marker: serde_json::Value = serde_json::from_str(&raw).expect("parse marker");
    marker["phase"] = serde_json::Value::String("applying".to_string());
    fs::write(&marker_path, serde_json::to_vec_pretty(&marker).unwrap()).expect("write marker");

    let staging = app.path().join(marker["staging_dir"].as_str().unwrap());
    let recovery = app.path().join(marker["recovery_dir"].as_str().unwrap());
    let before_swap = recovery.join("active-before-swap");
    fs::create_dir_all(&before_swap).expect("create before-swap");
    for name in ["dace.db", "dace.db-wal", "dace.db-shm"] {
        let active = app.path().join(name);
        if active.exists() {
            fs::rename(&active, before_swap.join(name)).expect("move active db aside");
        }
    }
    fs::rename(staging.join("database").join("dace.db"), app.path().join("dace.db"))
        .expect("install staged database");

    let outcome = apply_pending_restore(app.path()).unwrap().expect("outcome");
    assert!(!outcome.success);
    assert!(
        outcome.message.to_lowercase().contains("interrupted"),
        "unexpected message: {}",
        outcome.message
    );

    assert_eq!(record_count(app.path()), 1, "interrupted restore must be rolled back");
    let conn = Connection::open(app.path().join("dace.db")).expect("open db");
    let current: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM records WHERE id='current-record'",
            [],
            |row| row.get(0),
        )
        .expect("count current");
    assert_eq!(current, 1);
    assert!(
        app.path()
            .join("attachments")
            .join(&current_seed.relative_path)
            .exists(),
        "previous attachments must remain after rollback"
    );
    assert!(!app.path().join(RESTORE_MARKER_FILE).exists());
    assert!(first_recovery_dir(app.path()).exists());
}

#[test]
fn test_interrupted_rollback_removes_failed_restore_wal_and_shm() {
    let source = TempDirGuard::new("restore-interrupt-sidecar-source");
    let (archive, _) = create_rich_archive(source.path());
    let app = TempDirGuard::new("restore-interrupt-sidecar-app");
    let (current_db, current_seed) = create_current_environment(app.path());

    prepare_restore(app.path(), &archive, Some(&current_db), None).expect("prepare restore");

    let marker_path = app.path().join(RESTORE_MARKER_FILE);
    let mut marker: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&marker_path).expect("read marker"))
            .expect("parse marker");
    marker["phase"] = serde_json::Value::String("applying".to_string());
    fs::write(&marker_path, serde_json::to_vec_pretty(&marker).unwrap()).expect("write marker");

    let staging = app.path().join(marker["staging_dir"].as_str().unwrap());
    let recovery = app.path().join(marker["recovery_dir"].as_str().unwrap());
    let before_swap = recovery.join("active-before-swap");
    fs::create_dir_all(&before_swap).expect("create before-swap");
    for name in ["dace.db", "dace.db-wal", "dace.db-shm"] {
        let active = app.path().join(name);
        if active.exists() {
            fs::rename(&active, before_swap.join(name)).expect("move active db file aside");
        }
    }
    fs::rename(
        staging.join("database").join("dace.db"),
        app.path().join("dace.db"),
    )
    .expect("install staged database");

    // Simulate WAL/SHM artifacts created by the interrupted replacement. They
    // have no saved counterparts in active-before-swap and must not survive.
    fs::write(app.path().join("dace.db-wal"), b"stale wal from failed restore")
        .expect("write stale wal");
    fs::write(app.path().join("dace.db-shm"), b"stale shm from failed restore")
        .expect("write stale shm");

    let outcome = apply_pending_restore(app.path()).unwrap().expect("outcome");
    assert!(!outcome.success);
    assert!(
        outcome.message.to_lowercase().contains("interrupted"),
        "unexpected message: {}",
        outcome.message
    );
    assert!(
        !app.path().join("dace.db-wal").exists(),
        "stale WAL from the failed restore must be removed"
    );
    assert!(
        !app.path().join("dace.db-shm").exists(),
        "stale SHM from the failed restore must be removed"
    );
    assert_eq!(record_count(app.path()), 1, "previous data must be restored");
    assert!(
        app.path()
            .join("attachments")
            .join(&current_seed.relative_path)
            .exists(),
        "previous attachments must be restored"
    );
    assert!(!app.path().join(RESTORE_MARKER_FILE).exists());
}

#[test]
fn test_successful_restore_result_is_reported_once_and_staging_is_cleaned() {
    let source = TempDirGuard::new("restore-result-source");
    let (archive, _) = create_rich_archive(source.path());
    let app = TempDirGuard::new("restore-result-app");
    let (current_db, _) = create_current_environment(app.path());

    prepare_restore(app.path(), &archive, Some(&current_db), None).expect("prepare");
    let outcome = apply_pending_restore(app.path()).unwrap().unwrap();
    assert!(outcome.success);

    let staging = app.path().join(RESTORE_STAGING_DIR);
    if staging.exists() {
        assert!(
            fs::read_dir(&staging).expect("read staging").next().is_none(),
            "successful restore must clean staging"
        );
    }
    let result = take_restore_result(app.path()).unwrap().expect("result");
    assert!(result.success);
    assert!(result.message.to_lowercase().contains("verified"));
    assert!(take_restore_result(app.path()).unwrap().is_none());
}

#[test]
fn test_startup_confirmation_downgrades_stale_success_result() {
    let app = TempDirGuard::new("restore-startup-confirm");
    let (current_db, _current_seed) = create_current_environment(app.path());
    let db = Database::init(&current_db).expect("open live database");
    let storage =
        AttachmentStorage::new(&app.path().join("attachments")).expect("open live storage");

    let outcome = RestoreOutcome {
        success: true,
        message: "Restore completed: 999 records restored and verified.".to_string(),
        archive_path: None,
        record_count: Some(999),
        attachment_count: Some(0),
        recovery_dir: None,
        completed_at: chrono::Utc::now().to_rfc3339(),
    };
    fs::write(
        app.path().join(RESTORE_RESULT_FILE),
        serde_json::to_vec_pretty(&outcome).expect("serialize outcome"),
    )
    .expect("write result");

    confirm_startup_restore(app.path(), &db, &storage).expect("confirm startup restore");
    let confirmed = take_restore_result(app.path())
        .unwrap()
        .expect("result must remain available");
    assert!(!confirmed.success, "stale success must not be reported to the UI");
    assert!(
        confirmed.message.to_lowercase().contains("verification"),
        "unexpected message: {}",
        confirmed.message
    );
}

#[test]
fn test_checked_prepare_rejects_archive_changed_after_preview() {
    let source = TempDirGuard::new("fingerprint-source");
    let (archive, _seed) = create_rich_archive(source.path());
    let preview = inspect_archive(&archive).expect("inspect archive");

    let app = TempDirGuard::new("fingerprint-app");
    let (current_db, _current_seed) = create_current_environment(app.path());

    {
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&archive)
            .expect("open archive for mutation");
        file.write_all(b"\nchanged-after-preview")
            .expect("append to archive");
    }

    let err = prepare_restore_checked(
        app.path(),
        &archive,
        Some(&current_db),
        None,
        Some(preview.archive_size),
        Some(&preview.archive_sha256),
    )
    .expect_err("changed archive must be rejected");
    assert!(
        err.contains("changed since it was reviewed"),
        "unexpected error: {}",
        err
    );
    assert!(
        !app.path().join(RESTORE_MARKER_FILE).exists(),
        "rejected archive must not stage a restore"
    );
}

#[test]
fn test_critical_startup_marker_is_consumed_and_reported() {
    let app = TempDirGuard::new("critical-marker-app");
    fs::write(app.path().join(RESTORE_MARKER_FILE), b"{ malformed marker")
        .expect("write malformed marker");
    let stale_staging = app.path().join(RESTORE_STAGING_DIR).join("stale");
    fs::create_dir_all(&stale_staging).expect("create stale staging");

    record_startup_restore_error(app.path(), "marker unreadable")
        .expect("record startup restore error");
    assert!(
        app.path().join(RESTORE_FAILED_MARKER_FILE).exists(),
        "critical marker must be retained for startup consumption"
    );

    let outcome = apply_pending_restore(app.path())
        .expect("consume failed marker")
        .expect("failure outcome");
    assert!(!outcome.success);
    assert!(
        outcome.message.contains("could not be completed automatically"),
        "unexpected outcome: {}",
        outcome.message
    );
    assert!(
        !app.path().join(RESTORE_FAILED_MARKER_FILE).exists(),
        "failure marker must be consumed exactly once"
    );
    assert!(!stale_staging.exists(), "stale staging must be cleaned");

    let taken = take_restore_result(app.path())
        .expect("read result")
        .expect("result must remain for the UI");
    assert_eq!(taken.message, outcome.message);

    let second = apply_pending_restore(app.path()).expect("second startup after marker consumption");
    assert!(second.is_none(), "a consumed failure marker must never be processed again");
    assert!(take_restore_result(app.path()).unwrap().is_none());
}

#[test]
fn test_inspection_reports_fingerprint_extract_and_verify_stages() {
    let source = TempDirGuard::new("restore-progress-source");
    let (archive, _seed) = create_rich_archive(source.path());

    let stages = Arc::new(Mutex::new(Vec::<String>::new()));
    let progress = {
        let stages = Arc::clone(&stages);
        move |stage: &str, _current: usize, _total: usize, _message: &str| {
            stages
                .lock()
                .expect("lock progress stages")
                .push(stage.to_string());
        }
    };

    inspect_archive_with_progress(&archive, Some(&progress)).expect("inspect with progress");
    drop(progress);
    let stages = Arc::try_unwrap(stages)
        .expect("release progress callback")
        .into_inner()
        .expect("read progress stages");
    assert!(stages.iter().any(|stage| stage == "fingerprint"));
    assert!(stages.iter().any(|stage| stage == "extract"));
    assert!(stages.iter().any(|stage| stage == "verify"));
}

#[test]
fn test_checked_prepare_rejects_wrong_expected_size_and_hash() {
    let source = TempDirGuard::new("restore-expected-source");
    let (archive, _seed) = create_rich_archive(source.path());
    let app = TempDirGuard::new("restore-expected-app");
    let (current_db, _current_seed) = create_current_environment(app.path());
    let preview = inspect_archive(&archive).expect("inspect archive");

    let size_error = prepare_restore_checked(
        app.path(),
        &archive,
        Some(&current_db),
        None,
        Some(preview.archive_size + 1),
        Some(&preview.archive_sha256),
    )
    .expect_err("wrong size must be rejected");
    assert!(size_error.contains("changed since it was reviewed"));

    let hash_error = prepare_restore_checked(
        app.path(),
        &archive,
        Some(&current_db),
        None,
        Some(preview.archive_size),
        Some(&"0".repeat(64)),
    )
    .expect_err("wrong hash must be rejected");
    assert!(hash_error.contains("changed since it was reviewed"));

    assert!(!app.path().join(RESTORE_MARKER_FILE).exists());
    assert!(!app.path().join(RESTORE_RESULT_FILE).exists());
    assert_no_staging_entries(app.path());
    assert_eq!(record_count(app.path()), 1);
}

#[test]
fn test_prepare_failure_during_extraction_cleans_staging() {
    let temp = TempDirGuard::new("restore-extract-fail-source");
    let fake_db = b"placeholder".to_vec();
    let manifest = make_manifest(
        &fake_db,
        vec![attachment_entry("aa/missing.txt", b"missing", "att-missing")],
    );
    let db_payload = write_payload(temp.path(), "payload/db", &fake_db);
    let archive = temp.path().join("missing.dacebackup");
    write_backup(
        &archive,
        &manifest,
        &[archive_file(
            "database/dace.db",
            db_payload,
            manifest.database.sha256.clone(),
            fake_db.len() as u64,
        )],
    )
    .expect("write incomplete archive");

    let app = TempDirGuard::new("restore-extract-fail-app");
    let (current_db, current_seed) = create_current_environment(app.path());
    let err = prepare_restore(app.path(), &archive, Some(&current_db), None)
        .expect_err("incomplete archive must fail during extraction");
    assert!(err.to_lowercase().contains("missing"), "unexpected error: {}", err);

    assert!(!app.path().join(RESTORE_MARKER_FILE).exists());
    assert!(!app.path().join(RESTORE_RESULT_FILE).exists());
    assert_no_staging_entries(app.path());
    assert_eq!(record_count(app.path()), 1);
    assert!(
        app.path()
            .join("attachments")
            .join(&current_seed.relative_path)
            .exists(),
        "live attachments must be untouched"
    );
}

#[test]
fn test_startup_confirmation_detects_tampered_restored_attachment() {
    let source = TempDirGuard::new("restore-tamper-source");
    let (archive, seed) = create_rich_archive(source.path());
    let app = TempDirGuard::new("restore-tamper-app");
    let (current_db, _current_seed) = create_current_environment(app.path());

    prepare_restore(app.path(), &archive, Some(&current_db), None).expect("prepare restore");
    let outcome = apply_pending_restore(app.path()).unwrap().expect("outcome");
    assert!(outcome.success, "{}", outcome.message);

    fs::write(
        app.path().join("attachments").join(&seed.relative_path),
        b"tampered after restore",
    )
    .expect("tamper restored attachment");

    let db = Database::init(app.path().join("dace.db")).expect("open restored database");
    let storage =
        AttachmentStorage::new(app.path().join("attachments")).expect("open restored storage");
    confirm_startup_restore(app.path(), &db, &storage).expect("confirm startup restore");

    let confirmed = take_restore_result(app.path())
        .unwrap()
        .expect("result must remain for the UI");
    assert!(!confirmed.success, "tampered attachment must not be reported as verified");
    assert!(
        confirmed.message.contains("startup checksum verification"),
        "unexpected message: {}",
        confirmed.message
    );
}

#[test]
fn test_startup_cleanup_removes_loose_stale_staging_files() {
    let app = TempDirGuard::new("restore-loose-staging");
    let staging = app.path().join(RESTORE_STAGING_DIR);
    fs::create_dir_all(&staging).expect("create stale staging root");
    fs::write(staging.join("stale.dacebackup"), b"leftover").expect("write stale file");
    let stale_dir = staging.join("stale-extract");
    fs::create_dir_all(&stale_dir).expect("create stale dir");
    fs::write(stale_dir.join("payload"), b"leftover").expect("write stale payload");

    let outcome = apply_pending_restore(app.path()).expect("clean startup");
    assert!(outcome.is_none());
    assert_no_staging_entries(app.path());
}

#[test]
fn test_unreadable_marker_does_not_delete_active_staging() {
    let source = TempDirGuard::new("restore-marker-source");
    let (archive, _seed) = create_rich_archive(source.path());
    let app = TempDirGuard::new("restore-marker-app");
    let (current_db, _current_seed) = create_current_environment(app.path());

    prepare_restore(app.path(), &archive, Some(&current_db), None).expect("prepare restore");
    let marker_path = app.path().join(RESTORE_MARKER_FILE);
    let marker: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&marker_path).expect("read marker"))
            .expect("parse marker");
    let active_staging = app
        .path()
        .join(marker["staging_dir"].as_str().expect("staging dir"));
    assert!(active_staging.exists());

    fs::write(&marker_path, b"{ malformed marker").expect("corrupt marker");
    apply_pending_restore(app.path()).expect_err("unreadable marker must fail");
    assert!(
        active_staging.exists(),
        "an unreadable pending marker must not delete active restore staging"
    );
}

#[test]
fn test_archive_snapshot_stays_stable_when_original_changes() {
    let source = TempDirGuard::new("restore-snapshot-source");
    let (archive, _seed) = create_rich_archive(source.path());
    let preview = inspect_archive(&archive).expect("inspect original archive");

    let snapshot_dir = source.path().join("snapshot");
    let (stable_archive, snapshot_size, snapshot_hash) =
        snapshot_archive(&archive, &snapshot_dir, None).expect("snapshot archive");
    assert_eq!(snapshot_size, preview.archive_size);
    assert_eq!(snapshot_hash, preview.archive_sha256);

    fs::write(&archive, b"replaced after preview").expect("replace original archive");

    let stable_preview = inspect_archive(&stable_archive).expect("inspect stable snapshot");
    assert_eq!(stable_preview.archive_sha256, preview.archive_sha256);
    assert_eq!(stable_preview.record_count, preview.record_count);
    assert_eq!(stable_preview.attachment_count, preview.attachment_count);
}
