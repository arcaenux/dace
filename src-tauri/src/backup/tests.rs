use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::attachments::storage::AttachmentStorage;
use crate::db::Database;

use super::archive::{validate_backup, BackupManifest, BACKUP_FORMAT_VERSION};
use super::service::{create_backup_with_progress, snapshot_database};

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

fn sha256_hex_bytes(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

fn insert_record(conn: &Connection, id: &str, title: &str, content: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO records (id, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, title, content, now, now],
    )
    .expect("insert record");
}

fn insert_attachment_row(
    conn: &Connection,
    id: &str,
    file_name: &str,
    mime: &str,
    size: i64,
    hash: &str,
    storage_path: &str,
) {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO attachments (id, file_name, mime_type, file_size, sha256_hash, storage_path, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, file_name, mime, size, hash, storage_path, now, now],
    )
    .expect("insert attachment");
}

fn read_archive_manifest(path: &Path) -> BackupManifest {
    validate_backup(path).expect("archive should validate")
}

fn find_entry_data(archive_path: &Path, wanted: &str) -> Option<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = File::open(archive_path).expect("open archive");
    let mut magic = [0u8; 14];
    file.read_exact(&mut magic).ok()?;
    if &magic != super::archive::BACKUP_MAGIC {
        return None;
    }
    let mut ver = [0u8; 4];
    file.read_exact(&mut ver).ok()?;
    let mut len_buf = [0u8; 8];
    file.read_exact(&mut len_buf).ok()?;
    let manifest_len = u64::from_le_bytes(len_buf);
    file.seek(SeekFrom::Current(manifest_len as i64)).ok()?;
    loop {
        let mut path_len_buf = [0u8; 4];
        match file.read_exact(&mut path_len_buf) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return None,
            Err(_) => return None,
        }
        let path_len = u32::from_le_bytes(path_len_buf) as usize;
        let mut path_bytes = vec![0u8; path_len];
        file.read_exact(&mut path_bytes).ok()?;
        let path = String::from_utf8(path_bytes).ok()?;
        let mut sha = [0u8; 32];
        file.read_exact(&mut sha).ok()?;
        let mut size_buf = [0u8; 8];
        file.read_exact(&mut size_buf).ok()?;
        let size = u64::from_le_bytes(size_buf) as usize;
        let mut data = vec![0u8; size];
        file.read_exact(&mut data).ok()?;
        if path == wanted {
            return Some(data);
        }
    }
}

#[test]
fn test_empty_database_backup_and_manifest_validation() {
    let temp = TempDirGuard::new("backup-empty");
    let db_path = temp.path().join("dace.db");
    let attachments_dir = temp.path().join("attachments");
    let db = Database::init(&db_path).expect("init db");
    let storage = AttachmentStorage::new(&attachments_dir).expect("init storage");

    let dest = temp.path().join("empty.dacebackup");
    let result = create_backup_with_progress(&db, &storage, &dest, None).expect("backup should succeed");

    assert!(Path::new(&result.archive_path).exists(), "archive file must exist");
    assert_eq!(result.attachment_count, 0);
    assert!(result.archive_size > 0);

    let manifest = read_archive_manifest(Path::new(&result.archive_path));
    assert_eq!(manifest.format, "dace-backup");
    assert_eq!(manifest.format_version, BACKUP_FORMAT_VERSION);
    assert_eq!(manifest.attachments.len(), 0);
    assert_eq!(manifest.totals.attachment_count, 0);
    assert_eq!(manifest.database.archive_path, "database/dace.db");
    assert!(manifest.database.size > 0);
    assert_eq!(manifest.database.sha256.len(), 64);

    let db_bytes = find_entry_data(Path::new(&result.archive_path), "database/dace.db").expect("db entry");
    assert_eq!(db_bytes.len() as u64, manifest.database.size);
}

#[test]
fn test_database_snapshot_consistency_and_wal_committed_transactions() {
    let temp = TempDirGuard::new("backup-wal");
    let db_path = temp.path().join("dace.db");
    let attachments_dir = temp.path().join("attachments");
    let db = Database::init(&db_path).expect("init db");
    let _storage = AttachmentStorage::new(&attachments_dir).expect("init storage");

    {
        let conn = db.conn.lock().expect("lock db");
        insert_record(&conn, "rec-1", "Committed A", "alpha");
        insert_record(&conn, "rec-2", "Committed B", "beta");
        // Ensure writes are committed; WAL mode is enabled by Database::init
        conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE);").ok();
        insert_record(&conn, "rec-3", "Committed C", "gamma");
    }

    let snapshot_path = temp.path().join("snapshot.db");
    snapshot_database(&db, &snapshot_path).expect("snapshot should succeed");

    let snap_conn = Connection::open(&snapshot_path).expect("open snapshot");
    let count: i64 = snap_conn
        .query_row("SELECT COUNT(*) FROM records", [], |r| r.get(0))
        .expect("count records");
    assert_eq!(count, 3, "snapshot must include committed transactions");
    let title: String = snap_conn
        .query_row("SELECT title FROM records WHERE id='rec-3'", [], |r| r.get(0))
        .expect("read committed row");
    assert_eq!(title, "Committed C");

    // Live DB remains usable after snapshot
    {
        let conn = db.conn.lock().expect("lock live db");
        let live_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM records", [], |r| r.get(0))
            .expect("live count");
        assert_eq!(live_count, 3);
        insert_record(&conn, "rec-4", "After Snapshot", "delta");
    }

    // Backup archive also contains consistent DB
    let storage = AttachmentStorage::new(&attachments_dir).expect("init storage");
    let dest = temp.path().join("wal.dacebackup");
    create_backup_with_progress(&db, &storage, &dest, None).expect("backup");
    let db_bytes = find_entry_data(&dest, "database/dace.db").expect("db in archive");
    let archive_db_path = temp.path().join("from-archive.db");
    fs::write(&archive_db_path, db_bytes).expect("write extracted db");
    let archived_conn = Connection::open(&archive_db_path).expect("open archived db");
    let archived_count: i64 = archived_conn
        .query_row("SELECT COUNT(*) FROM records", [], |r| r.get(0))
        .expect("archived count");
    assert_eq!(archived_count, 4, "archive snapshot should reflect committed state at backup time");
}

#[test]
fn test_attachment_inclusion_sha256_verification_and_manifest_correctness() {
    let temp = TempDirGuard::new("backup-att");
    let db_path = temp.path().join("dace.db");
    let attachments_dir = temp.path().join("attachments");
    let db = Database::init(&db_path).expect("init db");
    let storage = AttachmentStorage::new(&attachments_dir).expect("init storage");

    // Create two managed attachment files in CAS layout
    let data1 = b"hello dace attachment one".to_vec();
    let hash1 = sha256_hex_bytes(&data1);
    let rel1 = format!("{}/{}.txt", &hash1[0..2], hash1);
    let full1 = attachments_dir.join(&rel1);
    fs::create_dir_all(full1.parent().unwrap()).expect("mkdir shard");
    fs::write(&full1, &data1).expect("write att1");

    let data2 = vec![42u8; 1024 * 32];
    let hash2 = sha256_hex_bytes(&data2);
    let rel2 = format!("{}/{}.bin", &hash2[0..2], hash2);
    let full2 = attachments_dir.join(&rel2);
    fs::create_dir_all(full2.parent().unwrap()).expect("mkdir shard2");
    fs::write(&full2, &data2).expect("write att2");

    {
        let conn = db.conn.lock().expect("lock");
        insert_record(&conn, "r1", "R", "C");
        insert_attachment_row(&conn, "a1", "one.txt", "text/plain", data1.len() as i64, &hash1, &rel1);
        insert_attachment_row(&conn, "a2", "two.bin", "application/octet-stream", data2.len() as i64, &hash2, &rel2);
        conn.execute(
            "INSERT INTO record_attachments (record_id, attachment_id, created_at) VALUES ('r1','a1',?1)",
            params![chrono::Utc::now().to_rfc3339()],
        ).expect("link");
    }

    let dest = temp.path().join("att.dacebackup");
    let result = create_backup_with_progress(&db, &storage, &dest, None).expect("backup");
    assert_eq!(result.attachment_count, 2);

    let manifest = read_archive_manifest(&dest);
    assert_eq!(manifest.totals.attachment_count, 2);
    assert_eq!(manifest.attachments.len(), 2);
    assert_eq!(manifest.totals.attachment_bytes, (data1.len() + data2.len()) as u64);
    assert!(manifest.attachments.iter().any(|a| a.relative_path == rel1 && a.sha256 == hash1 && a.size == data1.len() as u64));
    assert!(manifest.attachments.iter().any(|a| a.relative_path == rel2 && a.sha256 == hash2 && a.size == data2.len() as u64));

    let entry1 = find_entry_data(&dest, &format!("attachments/{}", rel1)).expect("att1 in archive");
    let entry2 = find_entry_data(&dest, &format!("attachments/{}", rel2)).expect("att2 in archive");
    assert_eq!(entry1, data1);
    assert_eq!(entry2, data2);
    assert_eq!(sha256_hex_bytes(&entry1), hash1);
    assert_eq!(sha256_hex_bytes(&entry2), hash2);

    // Validation must pass (covers archive validation requirement)
    validate_backup(&dest).expect("validate ok");
}

#[test]
fn test_missing_and_corrupted_attachments_fail_backup_without_publishing_archive() {
    let temp = TempDirGuard::new("backup-bad-att");
    let db_path = temp.path().join("dace.db");
    let attachments_dir = temp.path().join("attachments");
    let db = Database::init(&db_path).expect("init db");
    let storage = AttachmentStorage::new(&attachments_dir).expect("init storage");

    let data = b"original content".to_vec();
    let hash = sha256_hex_bytes(&data);
    let rel = format!("{}/{}.txt", &hash[0..2], hash);
    let full = attachments_dir.join(&rel);
    fs::create_dir_all(full.parent().unwrap()).expect("mkdir");
    fs::write(&full, &data).expect("write");

    {
        let conn = db.conn.lock().expect("lock");
        insert_attachment_row(&conn, "a1", "file.txt", "text/plain", data.len() as i64, &hash, &rel);
    }

    // Corrupted content
    fs::write(&full, b"tampered content").expect("tamper");
    let dest_corrupt = temp.path().join("corrupt.dacebackup");
    let err = create_backup_with_progress(&db, &storage, &dest_corrupt, None).expect_err("must fail");
    assert!(err.to_lowercase().contains("corrupt") || err.to_lowercase().contains("checksum") || err.to_lowercase().contains("integrity"), "error should report corruption: {}", err);
    assert!(!dest_corrupt.exists(), "failed backup must not publish archive");

    // Missing file
    fs::remove_file(&full).expect("remove");
    let dest_missing = temp.path().join("missing.dacebackup");
    let err = create_backup_with_progress(&db, &storage, &dest_missing, None).expect_err("must fail");
    assert!(err.to_lowercase().contains("missing"), "error should report missing file: {}", err);
    assert!(!dest_missing.exists(), "failed backup must not publish archive");
}

#[test]
fn test_interrupted_backup_cleanup_no_published_archive() {
    let temp = TempDirGuard::new("backup-cleanup");
    let db_path = temp.path().join("dace.db");
    let attachments_dir = temp.path().join("attachments");
    let db = Database::init(&db_path).expect("init db");
    let storage = AttachmentStorage::new(&attachments_dir).expect("init storage");

    // Create invalid state: attachment row points to missing file -> forces failure mid-process
    {
        let conn = db.conn.lock().expect("lock");
        insert_attachment_row(&conn, "a1", "gone.txt", "text/plain", 5, &"00".repeat(32), "00/missing.txt");
    }

    let dest = temp.path().join("cleanup.dacebackup");
    let _ = create_backup_with_progress(&db, &storage, &dest, None).expect_err("should fail");
    assert!(!dest.exists(), "no final archive on failure");

    // No temp archive files left behind
    let leftovers: Vec<_> = fs::read_dir(temp.path())
        .expect("read dir")
        .flatten()
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.contains(".dacebackup.tmp-") || name.starts_with(".dace-backup-")
        })
        .collect();
    assert!(leftovers.is_empty(), "temporary backup artifacts must be cleaned up: {:?}", leftovers);
}

#[test]
fn test_large_attachment_handling() {
    let temp = TempDirGuard::new("backup-large");
    let db_path = temp.path().join("dace.db");
    let attachments_dir = temp.path().join("attachments");
    let db = Database::init(&db_path).expect("init db");
    let storage = AttachmentStorage::new(&attachments_dir).expect("init storage");

    // ~8 MB payload to exercise streaming/hash without being excessive for tests
    let mut data = Vec::with_capacity(8 * 1024 * 1024);
    for i in 0..(8 * 1024 * 1024) {
        data.push((i % 251) as u8);
    }
    let hash = sha256_hex_bytes(&data);
    let rel = format!("{}/{}.bin", &hash[0..2], hash);
    let full = attachments_dir.join(&rel);
    fs::create_dir_all(full.parent().unwrap()).expect("mkdir");
    let mut f = File::create(&full).expect("create");
    f.write_all(&data).expect("write large");
    f.flush().expect("flush");

    {
        let conn = db.conn.lock().expect("lock");
        insert_attachment_row(&conn, "a-large", "large.bin", "application/octet-stream", data.len() as i64, &hash, &rel);
    }

    let dest = temp.path().join("large.dacebackup");
    let result = create_backup_with_progress(&db, &storage, &dest, None).expect("large backup should succeed");
    assert_eq!(result.attachment_count, 1);

    let manifest = read_archive_manifest(&dest);
    assert_eq!(manifest.attachments[0].size, data.len() as u64);
    let entry = find_entry_data(&dest, &format!("attachments/{}", rel)).expect("large entry");
    assert_eq!(entry.len(), data.len());
    assert_eq!(sha256_hex_bytes(&entry), hash);
}