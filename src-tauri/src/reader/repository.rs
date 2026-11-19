use rusqlite::{params, Connection, Result};
use uuid::Uuid;
use super::models::{
    Annotation, CreateHighlightInput, ExcerptCitation, Highlight, HighlightRecordLink,
};
use crate::knowledge::models::KnowledgeRecord;

pub struct ReaderRepository;

impl ReaderRepository {
    /// Creates a new highlight and optional initial annotation in SQLite.
    pub fn create_highlight(
        conn: &mut Connection,
        input: CreateHighlightInput,
    ) -> Result<Highlight, String> {
        // 1. Verify attachment exists and get its current SHA-256 hash
        let doc_sha256: String = conn
            .query_row(
                "SELECT sha256_hash FROM attachments WHERE id = ?1",
                params![input.attachment_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Attachment {} not found: {}", input.attachment_id, e))?;

        let highlight_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let tx = conn.transaction().map_err(|e| format!("Transaction error: {}", e))?;

        // 2. Insert highlight record
        tx.execute(
            "INSERT INTO highlights (
                id, attachment_id, doc_sha256, page_number, selected_text,
                anchor_data, highlight_type, color, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                highlight_id,
                input.attachment_id,
                doc_sha256,
                input.page_number,
                input.selected_text.trim(),
                input.anchor_data,
                input.highlight_type,
                input.color,
                now,
                now,
            ],
        )
        .map_err(|e| format!("Failed to insert highlight: {}", e))?;

        // 3. Optional initial annotation
        let mut annotation_obj: Option<Annotation> = None;
        if let Some(content) = input.annotation_content {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                let annotation_id = Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT INTO annotations (id, highlight_id, content, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![annotation_id, highlight_id, trimmed, now, now],
                )
                .map_err(|e| format!("Failed to insert annotation: {}", e))?;

                annotation_obj = Some(Annotation {
                    id: annotation_id,
                    highlight_id: highlight_id.clone(),
                    content: trimmed.to_string(),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                });
            }
        }

        tx.commit().map_err(|e| format!("Commit error: {}", e))?;

        Ok(Highlight {
            id: highlight_id,
            attachment_id: input.attachment_id,
            doc_sha256,
            page_number: input.page_number,
            selected_text: input.selected_text.trim().to_string(),
            anchor_data: input.anchor_data,
            highlight_type: input.highlight_type,
            color: input.color,
            created_at: now.clone(),
            updated_at: now,
            is_stale: false,
            annotation: annotation_obj,
            linked_record_count: 0,
        })
    }

    /// Retrieves all highlights for an attachment, joined with any annotations,
    /// and dynamically checks for checksum discrepancies (stale anchors).
    pub fn get_attachment_highlights(
        conn: &Connection,
        attachment_id: &str,
    ) -> Result<Vec<Highlight>, String> {
        let current_sha256: Option<String> = conn
            .query_row(
                "SELECT sha256_hash FROM attachments WHERE id = ?1",
                params![attachment_id],
                |row| row.get(0),
            )
            .ok();

        let mut stmt = conn
            .prepare(
                "SELECT h.id, h.attachment_id, h.doc_sha256, h.page_number, h.selected_text,
                        h.anchor_data, h.highlight_type, h.color, h.created_at, h.updated_at,
                        a.id, a.content, a.created_at, a.updated_at,
                        (SELECT COUNT(*) FROM highlight_records hr WHERE hr.highlight_id = h.id) as linked_count
                 FROM highlights h
                 LEFT JOIN annotations a ON a.highlight_id = h.id
                 WHERE h.attachment_id = ?1
                 ORDER BY h.page_number ASC, h.created_at ASC",
            )
            .map_err(|e| format!("Query prepare error: {}", e))?;

        let rows = stmt
            .query_map(params![attachment_id], |row| {
                let hid: String = row.get(0)?;
                let doc_sha: String = row.get(2)?;
                let aid: Option<String> = row.get(10)?;
                let acontent: Option<String> = row.get(11)?;
                let acreat: Option<String> = row.get(12)?;
                let aupd: Option<String> = row.get(13)?;

                let annotation = if let (Some(ann_id), Some(content), Some(c_at), Some(u_at)) =
                    (aid, acontent, acreat, aupd)
                {
                    Some(Annotation {
                        id: ann_id,
                        highlight_id: hid.clone(),
                        content,
                        created_at: c_at,
                        updated_at: u_at,
                    })
                } else {
                    None
                };

                let linked_count: i32 = row.get(14)?;

                let is_stale = match &current_sha256 {
                    Some(curr) => curr != &doc_sha,
                    None => true,
                };

                Ok(Highlight {
                    id: hid,
                    attachment_id: row.get(1)?,
                    doc_sha256: doc_sha,
                    page_number: row.get(3)?,
                    selected_text: row.get(4)?,
                    anchor_data: row.get(5)?,
                    highlight_type: row.get(6)?,
                    color: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                    is_stale,
                    annotation,
                    linked_record_count: linked_count,
                })
            })
            .map_err(|e| format!("Query map error: {}", e))?;

        let mut highlights = Vec::new();
        for r in rows {
            highlights.push(r.map_err(|e| format!("Row parse error: {}", e))?);
        }

        Ok(highlights)
    }

    /// Updates a highlight's type or color.
    pub fn update_highlight_type(
        conn: &Connection,
        highlight_id: &str,
        highlight_type: &str,
        color: Option<String>,
    ) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        let rows_affected = conn
            .execute(
                "UPDATE highlights SET highlight_type = ?1, color = ?2, updated_at = ?3 WHERE id = ?4",
                params![highlight_type, color, now, highlight_id],
            )
            .map_err(|e| format!("Failed to update highlight: {}", e))?;

        if rows_affected == 0 {
            return Err(format!("Highlight {} not found", highlight_id));
        }

        Ok(())
    }

    /// Deletes a highlight and all associated annotations and record links via foreign key CASCADE.
    pub fn delete_highlight(conn: &Connection, highlight_id: &str) -> Result<(), String> {
        let rows_affected = conn
            .execute("DELETE FROM highlights WHERE id = ?1", params![highlight_id])
            .map_err(|e| format!("Failed to delete highlight: {}", e))?;

        if rows_affected == 0 {
            return Err(format!("Highlight {} not found", highlight_id));
        }

        Ok(())
    }

    /// Upserts an annotation for a highlight.
    pub fn save_annotation(
        conn: &Connection,
        highlight_id: &str,
        content: &str,
    ) -> Result<Annotation, String> {
        let content_trimmed = content.trim();
        if content_trimmed.is_empty() {
            // Deleting empty annotation
            Self::delete_annotation(conn, highlight_id)?;
            return Err("Empty annotation content".to_string());
        }

        // Verify highlight exists
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM highlights WHERE id = ?1)",
                params![highlight_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !exists {
            return Err(format!("Highlight {} does not exist", highlight_id));
        }

        let now = chrono::Utc::now().to_rfc3339();
        let new_id = Uuid::new_v4().to_string();

        conn.execute(
            "INSERT INTO annotations (id, highlight_id, content, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT(highlight_id) DO UPDATE SET
                content = excluded.content,
                updated_at = excluded.updated_at",
            params![new_id, highlight_id, content_trimmed, now],
        )
        .map_err(|e| format!("Failed to upsert annotation: {}", e))?;

        // Query back the resulting annotation record
        let ann = conn
            .query_row(
                "SELECT id, highlight_id, content, created_at, updated_at FROM annotations WHERE highlight_id = ?1",
                params![highlight_id],
                |row| {
                    Ok(Annotation {
                        id: row.get(0)?,
                        highlight_id: row.get(1)?,
                        content: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                },
            )
            .map_err(|e| format!("Failed to retrieve saved annotation: {}", e))?;

        Ok(ann)
    }

    /// Deletes an annotation for a highlight.
    pub fn delete_annotation(conn: &Connection, highlight_id: &str) -> Result<(), String> {
        conn.execute(
            "DELETE FROM annotations WHERE highlight_id = ?1",
            params![highlight_id],
        )
        .map_err(|e| format!("Failed to delete annotation: {}", e))?;

        Ok(())
    }

    /// Links an excerpt/highlight to a knowledge record.
    pub fn link_highlight_to_record(
        conn: &mut Connection,
        highlight_id: &str,
        record_id: &str,
        commentary: Option<String>,
    ) -> Result<(), String> {
        // 1. Verify highlight and get attachment_id
        let attachment_id: String = conn
            .query_row(
                "SELECT attachment_id FROM highlights WHERE id = ?1",
                params![highlight_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Highlight {} not found: {}", highlight_id, e))?;

        // 2. Verify record exists
        let record_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM records WHERE id = ?1)",
                params![record_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !record_exists {
            return Err(format!("Record {} does not exist", record_id));
        }

        let now = chrono::Utc::now().to_rfc3339();
        let tx = conn.transaction().map_err(|e| format!("Transaction error: {}", e))?;

        // 3. Insert or update into highlight_records
        tx.execute(
            "INSERT INTO highlight_records (highlight_id, record_id, commentary, created_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(highlight_id, record_id) DO UPDATE SET
                commentary = excluded.commentary",
            params![highlight_id, record_id, commentary, now],
        )
        .map_err(|e| format!("Failed to link highlight to record: {}", e))?;

        // 4. Ensure record_attachments also associates the record with the attachment
        tx.execute(
            "INSERT OR IGNORE INTO record_attachments (record_id, attachment_id, created_at)
             VALUES (?1, ?2, ?3)",
            params![record_id, attachment_id, now],
        )
        .map_err(|e| format!("Failed to associate document with record: {}", e))?;

        tx.commit().map_err(|e| format!("Commit error: {}", e))?;

        Ok(())
    }

    /// Unlinks an excerpt/highlight from a knowledge record.
    pub fn unlink_highlight_from_record(
        conn: &Connection,
        highlight_id: &str,
        record_id: &str,
    ) -> Result<(), String> {
        conn.execute(
            "DELETE FROM highlight_records WHERE highlight_id = ?1 AND record_id = ?2",
            params![highlight_id, record_id],
        )
        .map_err(|e| format!("Failed to unlink highlight from record: {}", e))?;

        Ok(())
    }

    /// Retrieves all excerpts connected to a given record.
    pub fn get_record_excerpts(
        conn: &Connection,
        record_id: &str,
    ) -> Result<Vec<ExcerptCitation>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT hr.highlight_id, h.attachment_id, att.file_name, h.doc_sha256,
                        att.sha256_hash, h.page_number, h.selected_text, h.highlight_type,
                        hr.commentary, hr.created_at
                 FROM highlight_records hr
                 JOIN highlights h ON h.id = hr.highlight_id
                 JOIN attachments att ON att.id = h.attachment_id
                 WHERE hr.record_id = ?1
                 ORDER BY hr.created_at DESC",
            )
            .map_err(|e| format!("Prepare query error: {}", e))?;

        let rows = stmt
            .query_map(params![record_id], |row| {
                let doc_sha: String = row.get(3)?;
                let curr_sha: String = row.get(4)?;
                let is_stale = doc_sha != curr_sha;

                Ok(ExcerptCitation {
                    highlight_id: row.get(0)?,
                    attachment_id: row.get(1)?,
                    document_title: row.get(2)?,
                    page_number: row.get(5)?,
                    selected_text: row.get(6)?,
                    highlight_type: row.get(7)?,
                    commentary: row.get(8)?,
                    created_at: row.get(9)?,
                    is_stale,
                })
            })
            .map_err(|e| format!("Query map error: {}", e))?;

        let mut citations = Vec::new();
        for r in rows {
            citations.push(r.map_err(|e| format!("Parse citation error: {}", e))?);
        }

        Ok(citations)
    }

    /// Retrieves all knowledge records connected to a given highlight.
    pub fn get_highlight_records(
        conn: &Connection,
        highlight_id: &str,
    ) -> Result<Vec<HighlightRecordLink>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT hr.highlight_id, hr.record_id, r.title, hr.commentary, hr.created_at
                 FROM highlight_records hr
                 JOIN records r ON r.id = hr.record_id
                 WHERE hr.highlight_id = ?1
                 ORDER BY hr.created_at DESC",
            )
            .map_err(|e| format!("Prepare query error: {}", e))?;

        let rows = stmt
            .query_map(params![highlight_id], |row| {
                Ok(HighlightRecordLink {
                    highlight_id: row.get(0)?,
                    record_id: row.get(1)?,
                    record_title: row.get(2)?,
                    commentary: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| format!("Query map error: {}", e))?;

        let mut links = Vec::new();
        for r in rows {
            links.push(r.map_err(|e| format!("Parse link error: {}", e))?);
        }

        Ok(links)
    }

    /// Creates a new Knowledge Record derived from an excerpt passage.
    /// Preserves exact quoted text, attribution, and sets up bidirectional links.
    pub fn create_record_from_excerpt(
        conn: &mut Connection,
        highlight_id: &str,
        title: &str,
        commentary: Option<String>,
        has_fts5: bool,
    ) -> Result<KnowledgeRecord, String> {
        // 1. Fetch highlight & attachment details
        let (attachment_id, file_name, page_num, selected_text): (String, String, i32, String) = conn
            .query_row(
                "SELECT h.attachment_id, att.file_name, h.page_number, h.selected_text
                 FROM highlights h
                 JOIN attachments att ON att.id = h.attachment_id
                 WHERE h.id = ?1",
                params![highlight_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|e| format!("Highlight {} not found: {}", highlight_id, e))?;

        let record_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let record_title = if title.trim().is_empty() {
            format!("Insight from {} (p. {})", file_name, page_num)
        } else {
            title.trim().to_string()
        };

        // Formulate structured record content preserving original excerpt
        let initial_content = if let Some(comm) = &commentary {
            if !comm.trim().is_empty() {
                format!(
                    "> \"{}\"\n>\n> — *{}*, page {}\n\n{}\n",
                    selected_text.trim(),
                    file_name,
                    page_num,
                    comm.trim()
                )
            } else {
                format!(
                    "> \"{}\"\n>\n> — *{}*, page {}\n\n",
                    selected_text.trim(),
                    file_name,
                    page_num
                )
            }
        } else {
            format!(
                "> \"{}\"\n>\n> — *{}*, page {}\n\n",
                selected_text.trim(),
                file_name,
                page_num
            )
        };

        let tx = conn.transaction().map_err(|e| format!("Transaction error: {}", e))?;

        // 2. Insert record
        tx.execute(
            "INSERT INTO records (id, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![record_id, record_title, initial_content, now, now],
        )
        .map_err(|e| format!("Failed to insert record: {}", e))?;

        // 3. FTS5 indexing if enabled
        if has_fts5 {
            let _ = tx.execute(
                "INSERT INTO records_fts (record_id, title, content) VALUES (?1, ?2, ?3)",
                params![record_id, record_title, initial_content],
            );
        }

        // 4. Link highlight to the new record
        tx.execute(
            "INSERT INTO highlight_records (highlight_id, record_id, commentary, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![highlight_id, record_id, commentary, now],
        )
        .map_err(|e| format!("Failed to link highlight: {}", e))?;

        // 5. Associate record with the attachment
        tx.execute(
            "INSERT OR IGNORE INTO record_attachments (record_id, attachment_id, created_at)
             VALUES (?1, ?2, ?3)",
            params![record_id, attachment_id, now],
        )
        .map_err(|e| format!("Failed to associate document: {}", e))?;

        tx.commit().map_err(|e| format!("Commit error: {}", e))?;

        Ok(KnowledgeRecord {
            id: record_id,
            title: record_title,
            content: initial_content,
            created_at: now.clone(),
            updated_at: now,
            tags: Vec::new(),
        })
    }
}
