use std::io::Cursor;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::db::Database;
use super::repository::AttachmentRepository;
use super::storage::{infer_mime_type, AttachmentStorage};

struct TestDir(PathBuf);
impl TestDir {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("dace_att_test_{}", Uuid::new_v4()));
        let _ = std::fs::create_dir_all(&p);
        Self(p)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}
impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn test_storage_staged_ingestion_and_deduplication() {
    let tmp = TestDir::new();
    let storage = AttachmentStorage::new(tmp.path().join("attachments")).unwrap();

    let sample_data = b"Dace Milestone 5 - Content Addressed Storage Test Payload";
    let mut cursor = Cursor::new(sample_data);

    // 1. First Ingestion
    let stored1 = storage.stage_and_store(&mut cursor, "research_notes.txt").unwrap();
    assert_eq!(stored1.was_deduplicated, false);
    assert_eq!(stored1.file_size, sample_data.len() as u64);
    assert!(stored1.relative_path.ends_with(".txt"));
    assert!(stored1.relative_path.starts_with(&stored1.sha256_hash[..2]));

    // Verify file exists on disk
    let full_path = storage.resolve_path(&stored1.relative_path).unwrap();
    assert!(full_path.exists());

    // Verify integrity
    let (exists, hash_ok) = storage.verify_integrity(&stored1.relative_path, &stored1.sha256_hash);
    assert_eq!(exists, true);
    assert_eq!(hash_ok, true);

    // 2. Second Ingestion of identical content (with different name)
    let mut cursor2 = Cursor::new(sample_data);
    let stored2 = storage.stage_and_store(&mut cursor2, "duplicate_copy.txt").unwrap();
    assert_eq!(stored2.was_deduplicated, true);
    assert_eq!(stored2.sha256_hash, stored1.sha256_hash);
    assert_eq!(stored2.relative_path, stored1.relative_path);
}

#[test]
fn test_storage_tamper_detection_and_missing_file_resilience() {
    let tmp = TestDir::new();
    let storage = AttachmentStorage::new(tmp.path().join("attachments")).unwrap();

    let sample_data = b"Cryptographic integrity test data";
    let mut cursor = Cursor::new(sample_data);
    let stored = storage.stage_and_store(&mut cursor, "data.bin").unwrap();

    // 1. Initial check: ok
    let (exists, hash_ok) = storage.verify_integrity(&stored.relative_path, &stored.sha256_hash);
    assert_eq!(exists, true);
    assert_eq!(hash_ok, true);

    // 2. Tamper with file on disk
    let full_path = storage.resolve_path(&stored.relative_path).unwrap();
    std::fs::write(&full_path, b"Tampered corrupted bytes!").unwrap();

    let (exists_after_tamper, hash_ok_after_tamper) =
        storage.verify_integrity(&stored.relative_path, &stored.sha256_hash);
    assert_eq!(exists_after_tamper, true);
    assert_eq!(hash_ok_after_tamper, false, "Corrupted file must fail hash verification");

    // 3. Remove file on disk: missing file resilience
    std::fs::remove_file(&full_path).unwrap();
    let (exists_deleted, hash_ok_deleted) =
        storage.verify_integrity(&stored.relative_path, &stored.sha256_hash);
    assert_eq!(exists_deleted, false);
    assert_eq!(hash_ok_deleted, false);

    // Reading missing text should return clean error without panic
    let read_res = storage.read_text(&stored.relative_path, 1024);
    assert!(read_res.is_err());
}

#[test]
fn test_storage_path_traversal_prevention() {
    let tmp = TestDir::new();
    let storage = AttachmentStorage::new(tmp.path().join("attachments")).unwrap();

    assert!(storage.resolve_path("../../etc/passwd").is_err());
    assert!(storage.resolve_path("..\\..\\windows\\system32").is_err());
    assert!(storage.resolve_path("/absolute/unix/path").is_err());
}

#[test]
fn test_repository_attachment_and_record_association_lifecycle() {
    let db = Database::init_in_memory().unwrap();
    let conn = db.conn.lock().unwrap();

    // Create a knowledge record first
    conn.execute(
        "INSERT INTO records (id, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params!["rec-1", "Quantum Note", "Draft content", "2026-11-15T00:00:00Z", "2026-11-15T00:00:00Z"],
    ).unwrap();

    // 1. Create attachment linked to rec-1
    let (att, is_dup) = AttachmentRepository::create_or_reuse_attachment(
        &conn,
        "quantum_paper.pdf",
        "application/pdf",
        10240,
        "a1b2c3d4e5f600112233445566778899aabbccddeeff00112233445566778899",
        "a1/a1b2c3d4e5f600112233445566778899aabbccddeeff00112233445566778899.pdf",
        Some("rec-1"),
    ).unwrap();

    assert_eq!(is_dup, false);
    assert_eq!(att.file_name, "quantum_paper.pdf");

    // 2. Query attachments for rec-1
    let rec_attachments = AttachmentRepository::list_record_attachments(&conn, "rec-1").unwrap();
    assert_eq!(rec_attachments.len(), 1);
    assert_eq!(rec_attachments[0].id, att.id);
    assert_eq!(rec_attachments[0].record_count, 1);

    // 3. Associate with a second record: rec-2
    conn.execute(
        "INSERT INTO records (id, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params!["rec-2", "Related Concept", "Text", "2026-11-15T00:00:00Z", "2026-11-15T00:00:00Z"],
    ).unwrap();

    AttachmentRepository::associate_attachment(&conn, "rec-2", &att.id).unwrap();
    let associated_records = AttachmentRepository::get_associated_records(&conn, &att.id).unwrap();
    assert_eq!(associated_records.len(), 2);

    // 4. Disassociate from rec-1: attachment must remain in database
    let disassociated = AttachmentRepository::disassociate_attachment(&conn, "rec-1", &att.id).unwrap();
    assert_eq!(disassociated, true);

    let rec1_after = AttachmentRepository::list_record_attachments(&conn, "rec-1").unwrap();
    assert_eq!(rec1_after.len(), 0);

    let att_still_exists = AttachmentRepository::get_attachment(&conn, &att.id).unwrap();
    assert!(att_still_exists.is_some());

    // 5. Permanent deletion
    let (path, can_delete_physical) = AttachmentRepository::delete_attachment(&conn, &att.id).unwrap();
    assert_eq!(can_delete_physical, true);
    assert!(path.contains("a1/"));

    let att_gone = AttachmentRepository::get_attachment(&conn, &att.id).unwrap();
    assert!(att_gone.is_none());
}

#[test]
fn test_record_deletion_cascades_associations_without_deleting_attachment() {
    let db = Database::init_in_memory().unwrap();
    let conn = db.conn.lock().unwrap();

    conn.execute(
        "INSERT INTO records (id, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params!["rec-doomed", "Temporary Note", "Will be deleted", "2026-11-15T00:00:00Z", "2026-11-15T00:00:00Z"],
    ).unwrap();

    let (att, _) = AttachmentRepository::create_or_reuse_attachment(
        &conn,
        "spec.md",
        "text/markdown",
        2048,
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        "ff/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff.md",
        Some("rec-doomed"),
    ).unwrap();

    // Delete the record
    conn.execute("DELETE FROM records WHERE id = 'rec-doomed'", []).unwrap();

    // Verify junction row was removed by cascade
    let associated = AttachmentRepository::get_associated_records(&conn, &att.id).unwrap();
    assert_eq!(associated.len(), 0);

    // But the attachment metadata is preserved
    let att_preserved = AttachmentRepository::get_attachment(&conn, &att.id).unwrap();
    assert!(att_preserved.is_some());
}

#[test]
fn test_mime_type_inference() {
    assert_eq!(infer_mime_type("document.pdf", None), "application/pdf");
    assert_eq!(infer_mime_type("notes.md", None), "text/markdown");
    assert_eq!(infer_mime_type("readme.txt", None), "text/plain");
    assert_eq!(infer_mime_type("diagram.png", None), "image/png");
    assert_eq!(infer_mime_type("photo.jpg", None), "image/jpeg");
    assert_eq!(infer_mime_type("vector.svg", None), "image/svg+xml");
    assert_eq!(infer_mime_type("unknown.xyz123", None), "application/octet-stream");

    // Header magic bytes check
    assert_eq!(infer_mime_type("weird_file.bin", Some(b"%PDF-1.7")), "application/pdf");
    assert_eq!(infer_mime_type("weird_file.bin", Some(b"\x89PNG\r\n\x1a\n")), "image/png");
}
