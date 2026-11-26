use rusqlite::{params, Connection, Result};
use uuid::Uuid;

use super::models::{Attachment, AttachmentSummary};

pub struct AttachmentRepository;

impl AttachmentRepository {
    /// Inserts a new attachment into SQLite, and optionally links it to a record.
    /// If the file is a duplicate (same SHA-256 hash), reuses existing row or links directly.
    pub fn create_or_reuse_attachment(
        conn: &Connection,
        file_name: &str,
        mime_type: &str,
        file_size: i64,
        sha256_hash: &str,
        storage_path: &str,
        record_id: Option<&str>,
    ) -> Result<(Attachment, bool /* is_duplicate */), String> {
        let now = chrono::Utc::now().to_rfc3339();

        // 1. Check if an attachment with the exact same hash already exists
        let existing_opt: Option<Attachment> = conn
            .query_row(
                "SELECT id, file_name, mime_type, file_size, sha256_hash, storage_path, created_at, updated_at
                 FROM attachments
                 WHERE sha256_hash = ?1
                 LIMIT 1",
                params![sha256_hash],
                |row| {
                    Ok(Attachment {
                        id: row.get(0)?,
                        file_name: row.get(1)?,
                        mime_type: row.get(2)?,
                        file_size: row.get(3)?,
                        sha256_hash: row.get(4)?,
                        storage_path: row.get(5)?,
                        created_at: row.get(6)?,
                        updated_at: row.get(7)?,
                    })
                },
            )
            .ok();

        let (attachment, is_duplicate) = match existing_opt {
            Some(existing) => (existing, true),
            None => {
                let id = Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO attachments (id, file_name, mime_type, file_size, sha256_hash, storage_path, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        id,
                        file_name,
                        mime_type,
                        file_size,
                        sha256_hash,
                        storage_path,
                        now,
                        now
                    ],
                )
                .map_err(|e| format!("Failed to insert attachment row: {}", e))?;

                let att = Attachment {
                    id,
                    file_name: file_name.to_string(),
                    mime_type: mime_type.to_string(),
                    file_size,
                    sha256_hash: sha256_hash.to_string(),
                    storage_path: storage_path.to_string(),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                };
                (att, false)
            }
        };

        // 2. If record_id is supplied, associate with the record
        if let Some(rec_id) = record_id {
            // Check record exists
            let record_exists: bool = conn
                .query_row(
                    "SELECT 1 FROM records WHERE id = ?1",
                    params![rec_id],
                    |_| Ok(true),
                )
                .unwrap_or(false);

            if !record_exists {
                return Err(format!("Cannot associate attachment: record {} does not exist", rec_id));
            }

            conn.execute(
                "INSERT OR IGNORE INTO record_attachments (record_id, attachment_id, created_at)
                 VALUES (?1, ?2, ?3)",
                params![rec_id, attachment.id, now],
            )
            .map_err(|e| format!("Failed linking record to attachment: {}", e))?;
        }

        Ok((attachment, is_duplicate))
    }

    /// Fetches a single attachment by ID
    pub fn get_attachment(conn: &Connection, id: &str) -> Result<Option<Attachment>, String> {
        let att = conn
            .query_row(
                "SELECT id, file_name, mime_type, file_size, sha256_hash, storage_path, created_at, updated_at
                 FROM attachments
                 WHERE id = ?1",
                params![id],
                |row| {
                    Ok(Attachment {
                        id: row.get(0)?,
                        file_name: row.get(1)?,
                        mime_type: row.get(2)?,
                        file_size: row.get(3)?,
                        sha256_hash: row.get(4)?,
                        storage_path: row.get(5)?,
                        created_at: row.get(6)?,
                        updated_at: row.get(7)?,
                    })
                },
            )
            .ok();

        Ok(att)
    }

    /// Lists attachments associated with a specific knowledge record
    pub fn list_record_attachments(
        conn: &Connection,
        record_id: &str,
    ) -> Result<Vec<AttachmentSummary>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT a.id, a.file_name, a.mime_type, a.file_size, a.sha256_hash, a.created_at,
                        (SELECT COUNT(*) FROM record_attachments ra2 WHERE ra2.attachment_id = a.id) as ref_count
                 FROM attachments a
                 JOIN record_attachments ra ON a.id = ra.attachment_id
                 WHERE ra.record_id = ?1
                 ORDER BY ra.created_at DESC",
            )
            .map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt
            .query_map(params![record_id], |row| {
                Ok(AttachmentSummary {
                    id: row.get(0)?,
                    file_name: row.get(1)?,
                    mime_type: row.get(2)?,
                    file_size: row.get(3)?,
                    sha256_hash: row.get(4)?,
                    created_at: row.get(5)?,
                    record_count: row.get(6)?,
                    file_exists: true, // Will be verified against disk
                })
            })
            .map_err(|e| format!("Query error: {}", e))?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r.map_err(|e| format!("Row mapping error: {}", e))?);
        }

        Ok(list)
    }

    /// Lists all managed attachments across the entire knowledge vault
    pub fn list_all_attachments(conn: &Connection) -> Result<Vec<AttachmentSummary>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT a.id, a.file_name, a.mime_type, a.file_size, a.sha256_hash, a.created_at,
                        (SELECT COUNT(*) FROM record_attachments ra WHERE ra.attachment_id = a.id) as ref_count
                 FROM attachments a
                 ORDER BY a.created_at DESC",
            )
            .map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(AttachmentSummary {
                    id: row.get(0)?,
                    file_name: row.get(1)?,
                    mime_type: row.get(2)?,
                    file_size: row.get(3)?,
                    sha256_hash: row.get(4)?,
                    created_at: row.get(5)?,
                    record_count: row.get(6)?,
                    file_exists: true,
                })
            })
            .map_err(|e| format!("Query error: {}", e))?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r.map_err(|e| format!("Row mapping error: {}", e))?);
        }

        Ok(list)
    }

    /// Links an existing attachment to a record
    pub fn associate_attachment(
        conn: &Connection,
        record_id: &str,
        attachment_id: &str,
    ) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR IGNORE INTO record_attachments (record_id, attachment_id, created_at)
             VALUES (?1, ?2, ?3)",
            params![record_id, attachment_id, now],
        )
        .map_err(|e| format!("Failed to associate attachment: {}", e))?;

        Ok(())
    }

    /// Disassociates an attachment from a record. Does NOT delete the underlying attachment.
    pub fn disassociate_attachment(
        conn: &Connection,
        record_id: &str,
        attachment_id: &str,
    ) -> Result<bool, String> {
        let rows = conn
            .execute(
                "DELETE FROM record_attachments WHERE record_id = ?1 AND attachment_id = ?2",
                params![record_id, attachment_id],
            )
            .map_err(|e| format!("Failed to disassociate attachment: {}", e))?;

        Ok(rows > 0)
    }

    /// Resolve what a permanent delete would remove before touching the database or disk.
    /// Returns the storage_path and whether no other attachment row shares that file.
    pub fn deletion_target(
        conn: &Connection,
        attachment_id: &str,
    ) -> Result<(String, bool), String> {
        let attachment = Self::get_attachment(conn, attachment_id)?
            .ok_or_else(|| format!("Attachment {} not found", attachment_id))?;
        let remaining_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM attachments WHERE storage_path = ?1 AND id <> ?2",
                params![attachment.storage_path, attachment_id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        Ok((attachment.storage_path, remaining_count == 0))
    }

    /// Permanently deletes an attachment record.
    /// Returns the storage_path and a flag indicating whether this was the last attachment row using that storage path.
    pub fn delete_attachment(
        conn: &Connection,
        attachment_id: &str,
    ) -> Result<(String, bool), String> {
        let storage_path: String = conn
            .query_row(
                "SELECT storage_path FROM attachments WHERE id = ?1",
                params![attachment_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Attachment {} not found: {}", attachment_id, e))?;

        // Delete row (foreign keys cascade to record_attachments)
        conn.execute(
            "DELETE FROM attachments WHERE id = ?1",
            params![attachment_id],
        )
        .map_err(|e| format!("Failed to delete attachment: {}", e))?;

        // Check if any other attachments reference the same storage path
        let remaining_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM attachments WHERE storage_path = ?1",
                params![storage_path],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let can_delete_physical_file = remaining_count == 0;
        Ok((storage_path, can_delete_physical_file))
    }

    /// Returns list of record IDs associated with an attachment
    pub fn get_associated_records(
        conn: &Connection,
        attachment_id: &str,
    ) -> Result<Vec<String>, String> {
        let mut stmt = conn
            .prepare("SELECT record_id FROM record_attachments WHERE attachment_id = ?1")
            .map_err(|e| format!("Query error: {}", e))?;

        let rows = stmt
            .query_map(params![attachment_id], |row| row.get(0))
            .map_err(|e| format!("Query error: {}", e))?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r.map_err(|e| format!("Row error: {}", e))?);
        }

        Ok(list)
    }
}
