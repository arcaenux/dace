use rusqlite::{params, Connection, Result};
use uuid::Uuid;
use super::models::{
    CreateRecordPayload, KnowledgeRecord, KnowledgeRecordSummary, TagItem, UpdateRecordPayload,
};

pub struct KnowledgeRepository;

impl KnowledgeRepository {
    pub fn create_record(
        conn: &mut Connection,
        payload: CreateRecordPayload,
        has_fts5: bool,
    ) -> Result<KnowledgeRecord, String> {
        let record_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let tx = conn.transaction().map_err(|e| format!("Transaction error: {}", e))?;

        // 1. Insert Record
        tx.execute(
            "INSERT INTO records (id, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![record_id, payload.title.trim(), payload.content, now, now],
        ).map_err(|e| format!("Failed to insert record: {}", e))?;

        // 2. Insert into FTS5 index if enabled
        if has_fts5 {
            let _ = tx.execute(
                "INSERT INTO records_fts (record_id, title, content) VALUES (?1, ?2, ?3)",
                params![record_id, payload.title.trim(), payload.content],
            );
        }

        // 3. Process Tags
        let mut final_tags = Vec::new();
        if let Some(tags) = payload.tags {
            for raw_tag in tags {
                let tag_name = raw_tag.trim().to_lowercase();
                if tag_name.is_empty() {
                    continue;
                }

                // Get or create tag
                let tag_id: String = match tx.query_row(
                    "SELECT id FROM tags WHERE name = ?1",
                    params![tag_name],
                    |row| row.get(0),
                ) {
                    Ok(id) => id,
                    Err(_) => {
                        let new_id = Uuid::new_v4().to_string();
                        tx.execute(
                            "INSERT INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
                            params![new_id, tag_name, now],
                        ).map_err(|e| format!("Failed to insert tag: {}", e))?;
                        new_id
                    }
                };

                // Link tag to record
                tx.execute(
                    "INSERT OR IGNORE INTO record_tags (record_id, tag_id) VALUES (?1, ?2)",
                    params![record_id, tag_id],
                ).map_err(|e| format!("Failed to link record and tag: {}", e))?;

                if !final_tags.contains(&tag_name) {
                    final_tags.push(tag_name);
                }
            }
        }

        tx.commit().map_err(|e| format!("Commit error: {}", e))?;

        Ok(KnowledgeRecord {
            id: record_id,
            title: payload.title.trim().to_string(),
            content: payload.content,
            created_at: now.clone(),
            updated_at: now,
            tags: final_tags,
        })
    }

    pub fn get_record(conn: &Connection, id: &str) -> Result<Option<KnowledgeRecord>, String> {
        let mut stmt = conn
            .prepare("SELECT id, title, content, created_at, updated_at FROM records WHERE id = ?1")
            .map_err(|e| format!("Statement error: {}", e))?;

        let record_result = stmt.query_row(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        });

        match record_result {
            Ok((id, title, content, created_at, updated_at)) => {
                let tags = Self::get_tags_for_record(conn, &id)?;
                Ok(Some(KnowledgeRecord {
                    id,
                    title,
                    content,
                    created_at,
                    updated_at,
                    tags,
                }))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Query error: {}", e)),
        }
    }

    pub fn list_records(
        conn: &Connection,
        tag_filter: Option<String>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<KnowledgeRecordSummary>, String> {
        let lim = limit.unwrap_or(200);
        let off = offset.unwrap_or(0);

        let query = if tag_filter.is_some() {
            "SELECT DISTINCT r.id, r.title, r.content, r.created_at, r.updated_at
             FROM records r
             JOIN record_tags rt ON r.id = rt.record_id
             JOIN tags t ON rt.tag_id = t.id
             WHERE t.name = ?1
             ORDER BY r.updated_at DESC
             LIMIT ?2 OFFSET ?3"
        } else {
            "SELECT r.id, r.title, r.content, r.created_at, r.updated_at
             FROM records r
             ORDER BY r.updated_at DESC
             LIMIT ?1 OFFSET ?2"
        };

        let mut summaries = Vec::new();

        if let Some(ref tag) = tag_filter {
            let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![tag.to_lowercase(), lim, off], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            }).map_err(|e| e.to_string())?;

            for item in rows {
                let (id, title, content, created_at, updated_at) = item.map_err(|e| e.to_string())?;
                let preview = Self::make_preview(&content);
                let tags = Self::get_tags_for_record(conn, &id)?;
                summaries.push(KnowledgeRecordSummary {
                    id,
                    title,
                    preview,
                    created_at,
                    updated_at,
                    tags,
                });
            }
        } else {
            let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![lim, off], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            }).map_err(|e| e.to_string())?;

            for item in rows {
                let (id, title, content, created_at, updated_at) = item.map_err(|e| e.to_string())?;
                let preview = Self::make_preview(&content);
                let tags = Self::get_tags_for_record(conn, &id)?;
                summaries.push(KnowledgeRecordSummary {
                    id,
                    title,
                    preview,
                    created_at,
                    updated_at,
                    tags,
                });
            }
        }

        Ok(summaries)
    }

    pub fn update_record(
        conn: &mut Connection,
        payload: UpdateRecordPayload,
        has_fts5: bool,
    ) -> Result<KnowledgeRecord, String> {
        let now = chrono::Utc::now().to_rfc3339();

        let tx = conn.transaction().map_err(|e| format!("Transaction error: {}", e))?;

        // 1. Verify existence and retrieve created_at
        let created_at: String = match tx.query_row(
            "SELECT created_at FROM records WHERE id = ?1",
            params![payload.id],
            |row| row.get(0),
        ) {
            Ok(ca) => ca,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(format!("Record with id {} does not exist", payload.id))
            }
            Err(e) => return Err(format!("Database error: {}", e)),
        };

        // 2. Update record
        tx.execute(
            "UPDATE records SET title = ?1, content = ?2, updated_at = ?3 WHERE id = ?4",
            params![payload.title.trim(), payload.content, now, payload.id],
        ).map_err(|e| format!("Failed to update record: {}", e))?;

        // 3. Update FTS5 index
        if has_fts5 {
            let _ = tx.execute("DELETE FROM records_fts WHERE record_id = ?1", params![payload.id]);
            let _ = tx.execute(
                "INSERT INTO records_fts (record_id, title, content) VALUES (?1, ?2, ?3)",
                params![payload.id, payload.title.trim(), payload.content],
            );
        }

        // 4. Synchronize tags if provided
        let mut final_tags = Vec::new();
        if let Some(tags) = payload.tags {
            // Delete existing links for this record
            tx.execute(
                "DELETE FROM record_tags WHERE record_id = ?1",
                params![payload.id],
            ).map_err(|e| format!("Failed to clear existing tags: {}", e))?;

            for raw_tag in tags {
                let tag_name = raw_tag.trim().to_lowercase();
                if tag_name.is_empty() {
                    continue;
                }

                let tag_id: String = match tx.query_row(
                    "SELECT id FROM tags WHERE name = ?1",
                    params![tag_name],
                    |row| row.get(0),
                ) {
                    Ok(id) => id,
                    Err(_) => {
                        let new_id = Uuid::new_v4().to_string();
                        tx.execute(
                            "INSERT INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
                            params![new_id, tag_name, now],
                        ).map_err(|e| format!("Failed to insert tag: {}", e))?;
                        new_id
                    }
                };

                tx.execute(
                    "INSERT OR IGNORE INTO record_tags (record_id, tag_id) VALUES (?1, ?2)",
                    params![payload.id, tag_id],
                ).map_err(|e| format!("Failed to link record and tag: {}", e))?;

                if !final_tags.contains(&tag_name) {
                    final_tags.push(tag_name);
                }
            }

            // Cleanup orphaned tags
            let _ = tx.execute(
                "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM record_tags)",
                [],
            );
        } else {
            // Keep existing tags
            final_tags = Self::get_tags_for_record(&tx, &payload.id)?;
        }

        tx.commit().map_err(|e| format!("Commit error: {}", e))?;

        Ok(KnowledgeRecord {
            id: payload.id,
            title: payload.title.trim().to_string(),
            content: payload.content,
            created_at,
            updated_at: now,
            tags: final_tags,
        })
    }

    pub fn delete_record(conn: &mut Connection, id: &str, has_fts5: bool) -> Result<bool, String> {
        let tx = conn.transaction().map_err(|e| format!("Transaction error: {}", e))?;

        let affected = tx.execute("DELETE FROM records WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete record: {}", e))?;

        if affected == 0 {
            return Ok(false);
        }

        if has_fts5 {
            let _ = tx.execute("DELETE FROM records_fts WHERE record_id = ?1", params![id]);
        }

        // Clean up orphan tags
        let _ = tx.execute(
            "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM record_tags)",
            [],
        );

        tx.commit().map_err(|e| format!("Commit error: {}", e))?;
        Ok(true)
    }

    pub fn search_records(
        conn: &Connection,
        query: &str,
        has_fts5: bool,
    ) -> Result<Vec<KnowledgeRecordSummary>, String> {
        let clean = query.trim();
        if clean.is_empty() {
            return Self::list_records(conn, None, Some(50), Some(0));
        }

        // 1. Try FTS5 if supported
        if has_fts5 {
            let fts_query = format!("{}*", clean.replace('"', "").replace('*', ""));
            let stmt_res = conn.prepare(
                "SELECT r.id, r.title, r.content, r.created_at, r.updated_at
                 FROM records r
                 JOIN records_fts f ON r.id = f.record_id
                 WHERE records_fts MATCH ?1
                 ORDER BY r.updated_at DESC
                 LIMIT 100",
            );

            if let Ok(mut stmt) = stmt_res {
                let rows = stmt.query_map(params![fts_query], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                });

                if let Ok(iter) = rows {
                    let mut results = Vec::new();
                    for item in iter.flatten() {
                        let (id, title, content, created_at, updated_at) = item;
                        let preview = Self::make_preview(&content);
                        let tags = Self::get_tags_for_record(conn, &id).unwrap_or_default();
                        results.push(KnowledgeRecordSummary {
                            id,
                            title,
                            preview,
                            created_at,
                            updated_at,
                            tags,
                        });
                    }
                    if !results.is_empty() {
                        return Ok(results);
                    }
                }
            }
        }

        // 2. Fallback to Parameterized SQL LIKE across title and content
        let like_param = format!("%{}%", clean);
        let mut stmt = conn.prepare(
            "SELECT id, title, content, created_at, updated_at
             FROM records
             WHERE title LIKE ?1 OR content LIKE ?1
             ORDER BY updated_at DESC
             LIMIT 100",
        ).map_err(|e| format!("Prepare error: {}", e))?;

        let rows = stmt.query_map(params![like_param], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        }).map_err(|e| format!("Query error: {}", e))?;

        let mut results = Vec::new();
        for item in rows {
            let (id, title, content, created_at, updated_at) = item.map_err(|e| e.to_string())?;
            let preview = Self::make_preview(&content);
            let tags = Self::get_tags_for_record(conn, &id)?;
            results.push(KnowledgeRecordSummary {
                id,
                title,
                preview,
                created_at,
                updated_at,
                tags,
            });
        }

        Ok(results)
    }

    pub fn list_tags(conn: &Connection) -> Result<Vec<TagItem>, String> {
        let mut stmt = conn.prepare(
            "SELECT t.id, t.name, COUNT(rt.record_id) as count
             FROM tags t
             LEFT JOIN record_tags rt ON t.id = rt.tag_id
             GROUP BY t.id, t.name
             ORDER BY t.name ASC",
        ).map_err(|e| format!("Prepare error: {}", e))?;

        let rows = stmt.query_map([], |row| {
            Ok(TagItem {
                id: row.get(0)?,
                name: row.get(1)?,
                count: row.get(2)?,
            })
        }).map_err(|e| format!("Query error: {}", e))?;

        let mut tags = Vec::new();
        for item in rows {
            tags.push(item.map_err(|e| e.to_string())?);
        }

        Ok(tags)
    }

    fn get_tags_for_record(conn: &Connection, record_id: &str) -> Result<Vec<String>, String> {
        let mut stmt = conn.prepare(
            "SELECT t.name
             FROM tags t
             JOIN record_tags rt ON t.id = rt.tag_id
             WHERE rt.record_id = ?1
             ORDER BY t.name ASC",
        ).map_err(|e| format!("Prepare error: {}", e))?;

        let rows = stmt.query_map(params![record_id], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Query error: {}", e))?;

        let mut tags = Vec::new();
        for item in rows {
            tags.push(item.map_err(|e| e.to_string())?);
        }

        Ok(tags)
    }

    fn make_preview(content: &str) -> String {
        let single_line = content.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
        let trimmed = single_line.trim();
        if trimmed.chars().count() > 140 {
            let truncated: String = trimmed.chars().take(137).collect();
            format!("{}...", truncated)
        } else {
            trimmed.to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn test_record_lifecycle_and_search() {
        let db = Database::init_in_memory().expect("in-memory DB init failed");
        let mut conn = db.conn.lock().unwrap();

        // 1. Create Record
        let created = KnowledgeRepository::create_record(
            &mut conn,
            CreateRecordPayload {
                title: "Epistemic Architecture in NOVA DOME".to_string(),
                content: "Knowledge records must be atomic and connected through explicit typed relationships.".to_string(),
                tags: Some(vec!["epistemology".to_string(), "architecture".to_string()]),
            },
            db.has_fts5,
        ).expect("create_record failed");

        assert_eq!(created.title, "Epistemic Architecture in NOVA DOME");
        assert_eq!(created.tags.len(), 2);
        assert!(created.tags.contains(&"epistemology".to_string()));
        assert!(created.tags.contains(&"architecture".to_string()));

        // 2. Retrieve by ID
        let retrieved = KnowledgeRepository::get_record(&conn, &created.id)
            .expect("get_record failed")
            .expect("record not found");
        assert_eq!(retrieved.id, created.id);
        assert_eq!(retrieved.content, created.content);

        // 3. Search by title
        let search_title = KnowledgeRepository::search_records(&conn, "Epistemic", db.has_fts5)
            .expect("search failed");
        assert_eq!(search_title.len(), 1);
        assert_eq!(search_title[0].id, created.id);

        // 4. Search by content
        let search_content = KnowledgeRepository::search_records(&conn, "atomic", db.has_fts5)
            .expect("search failed");
        assert_eq!(search_content.len(), 1);
        assert_eq!(search_content[0].id, created.id);

        // 5. Update record
        let updated = KnowledgeRepository::update_record(
            &mut conn,
            UpdateRecordPayload {
                id: created.id.clone(),
                title: "Epistemic Architecture v2".to_string(),
                content: "Updated atomic content with rigorous verification.".to_string(),
                tags: Some(vec!["epistemology".to_string(), "verification".to_string()]),
            },
            db.has_fts5,
        ).expect("update failed");

        assert_eq!(updated.title, "Epistemic Architecture v2");
        assert_eq!(updated.tags.len(), 2);
        assert!(!updated.tags.contains(&"architecture".to_string()));
        assert!(updated.tags.contains(&"verification".to_string()));

        // 6. Verify tags listing
        let tags = KnowledgeRepository::list_tags(&conn).expect("list_tags failed");
        let tag_names: Vec<String> = tags.iter().map(|t| t.name.clone()).collect();
        assert!(tag_names.contains(&"epistemology".to_string()));
        assert!(tag_names.contains(&"verification".to_string()));
        assert!(!tag_names.contains(&"architecture".to_string())); // cleaned up

        // 7. Delete record
        let deleted = KnowledgeRepository::delete_record(&mut conn, &created.id, db.has_fts5)
            .expect("delete failed");
        assert!(deleted);

        // Verify gone
        let get_after_del = KnowledgeRepository::get_record(&conn, &created.id).unwrap();
        assert!(get_after_del.is_none());

        // Verify tags cleaned up after deletion
        let tags_after_del = KnowledgeRepository::list_tags(&conn).unwrap();
        assert_eq!(tags_after_del.len(), 0);
    }

    #[test]
    fn test_sqlite_file_persistence_across_restarts() {
        let temp_dir = std::env::temp_dir().join(format!("novadome_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let db_file = temp_dir.join("test_novadome.db");

        let record_id;

        // Session 1: Create record and flush to disk
        {
            let db = Database::init(&db_file).expect("session 1 init failed");
            let mut conn = db.conn.lock().unwrap();

            let created = KnowledgeRepository::create_record(
                &mut conn,
                CreateRecordPayload {
                    title: "Persistent Research Note".to_string(),
                    content: "This record must survive process termination and restarts.".to_string(),
                    tags: Some(vec!["persistence".to_string(), "sqlite".to_string()]),
                },
                db.has_fts5,
            ).expect("create failed");

            record_id = created.id;
        }

        // Session 2: Reopen same database file on disk to simulate restart
        {
            let db = Database::init(&db_file).expect("session 2 restart init failed");
            let conn = db.conn.lock().unwrap();

            let loaded = KnowledgeRepository::get_record(&conn, &record_id)
                .expect("get failed")
                .expect("record missing after restart!");

            assert_eq!(loaded.title, "Persistent Research Note");
            assert_eq!(loaded.content, "This record must survive process termination and restarts.");
            assert_eq!(loaded.tags.len(), 2);
            assert!(loaded.tags.contains(&"persistence".to_string()));
            assert!(loaded.tags.contains(&"sqlite".to_string()));

            // Verify search works across restart
            let search_res = KnowledgeRepository::search_records(&conn, "survive", db.has_fts5)
                .expect("search failed after restart");
            assert_eq!(search_res.len(), 1);
            assert_eq!(search_res[0].id, record_id);
        }

        // Clean up temporary test file
        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
