use rusqlite::{params, Connection, Result};
use uuid::Uuid;
use super::models::{
    CreateRecordPayload, CreateRelationshipPayload, GraphEdge, GraphNode, KnowledgeGraphData,
    KnowledgeRecord, KnowledgeRecordSummary, RecordRelationshipItem, RecordRelationshipsResponse,
    TagItem, UpdateRecordPayload,
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

    pub fn create_relationship(
        conn: &mut Connection,
        payload: CreateRelationshipPayload,
    ) -> Result<RecordRelationshipItem, String> {
        let source_id = payload.source_id.trim();
        let target_id = payload.target_id.trim();
        let relation_type = payload.relation_type.trim().to_lowercase();
        let description = payload.description.map(|d| d.trim().to_string()).filter(|d| !d.is_empty());

        if source_id.is_empty() || target_id.is_empty() {
            return Err("Source and target record IDs must not be empty".to_string());
        }

        if source_id == target_id {
            return Err("A record cannot be related to itself".to_string());
        }

        if relation_type.is_empty() {
            return Err("Relationship type must not be empty".to_string());
        }

        let rel_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        let tx = conn.transaction().map_err(|e| format!("Transaction error: {}", e))?;

        // 1. Fetch source title and target title to verify existence
        let source_title: String = match tx.query_row(
            "SELECT title FROM records WHERE id = ?1",
            params![source_id],
            |row| row.get(0),
        ) {
            Ok(t) => t,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(format!("Source record {} does not exist", source_id))
            }
            Err(e) => return Err(format!("Database error: {}", e)),
        };

        let target_title: String = match tx.query_row(
            "SELECT title FROM records WHERE id = ?1",
            params![target_id],
            |row| row.get(0),
        ) {
            Ok(t) => t,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                return Err(format!("Target record {} does not exist", target_id))
            }
            Err(e) => return Err(format!("Database error: {}", e)),
        };

        // 2. Insert relationship
        match tx.execute(
            "INSERT INTO record_relationships (id, source_id, target_id, relation_type, description, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![rel_id, source_id, target_id, relation_type, description, now],
        ) {
            Ok(_) => (),
            Err(rusqlite::Error::SqliteFailure(err, _)) if err.code == rusqlite::ErrorCode::ConstraintViolation => {
                return Err(format!(
                    "A '{}' relationship already exists between these records",
                    relation_type
                ));
            }
            Err(e) => return Err(format!("Failed to insert relationship: {}", e)),
        };

        tx.commit().map_err(|e| format!("Commit error: {}", e))?;

        Ok(RecordRelationshipItem {
            id: rel_id,
            source_id: source_id.to_string(),
            source_title,
            target_id: target_id.to_string(),
            target_title,
            relation_type,
            description,
            created_at: now,
            is_outgoing: true,
        })
    }

    pub fn delete_relationship(conn: &mut Connection, id: &str) -> Result<bool, String> {
        let clean_id = id.trim();
        let affected = conn.execute(
            "DELETE FROM record_relationships WHERE id = ?1",
            params![clean_id],
        ).map_err(|e| format!("Failed to delete relationship: {}", e))?;

        Ok(affected > 0)
    }

    pub fn get_record_relationships(
        conn: &Connection,
        record_id: &str,
    ) -> Result<RecordRelationshipsResponse, String> {
        let clean_id = record_id.trim();

        // 1. Outgoing relationships: source is this record
        let mut outgoing_stmt = conn.prepare(
            "SELECT rel.id, rel.source_id, s.title, rel.target_id, t.title, rel.relation_type, rel.description, rel.created_at
             FROM record_relationships rel
             JOIN records s ON rel.source_id = s.id
             JOIN records t ON rel.target_id = t.id
             WHERE rel.source_id = ?1
             ORDER BY rel.created_at DESC",
        ).map_err(|e| format!("Prepare outgoing error: {}", e))?;

        let outgoing_rows = outgoing_stmt.query_map(params![clean_id], |row| {
            Ok(RecordRelationshipItem {
                id: row.get(0)?,
                source_id: row.get(1)?,
                source_title: row.get(2)?,
                target_id: row.get(3)?,
                target_title: row.get(4)?,
                relation_type: row.get(5)?,
                description: row.get(6)?,
                created_at: row.get(7)?,
                is_outgoing: true,
            })
        }).map_err(|e| format!("Query outgoing error: {}", e))?;

        let mut outgoing = Vec::new();
        for item in outgoing_rows {
            outgoing.push(item.map_err(|e| e.to_string())?);
        }

        // 2. Incoming relationships: target is this record
        let mut incoming_stmt = conn.prepare(
            "SELECT rel.id, rel.source_id, s.title, rel.target_id, t.title, rel.relation_type, rel.description, rel.created_at
             FROM record_relationships rel
             JOIN records s ON rel.source_id = s.id
             JOIN records t ON rel.target_id = t.id
             WHERE rel.target_id = ?1
             ORDER BY rel.created_at DESC",
        ).map_err(|e| format!("Prepare incoming error: {}", e))?;

        let incoming_rows = incoming_stmt.query_map(params![clean_id], |row| {
            Ok(RecordRelationshipItem {
                id: row.get(0)?,
                source_id: row.get(1)?,
                source_title: row.get(2)?,
                target_id: row.get(3)?,
                target_title: row.get(4)?,
                relation_type: row.get(5)?,
                description: row.get(6)?,
                created_at: row.get(7)?,
                is_outgoing: false,
            })
        }).map_err(|e| format!("Query incoming error: {}", e))?;

        let mut incoming = Vec::new();
        for item in incoming_rows {
            incoming.push(item.map_err(|e| e.to_string())?);
        }

        Ok(RecordRelationshipsResponse { outgoing, incoming })
    }

    pub fn get_knowledge_graph(conn: &Connection) -> Result<KnowledgeGraphData, String> {
        // 1. Fetch all nodes with connection counts
        let mut node_stmt = conn.prepare(
            "SELECT r.id, r.title, r.content, r.updated_at,
                    (SELECT COUNT(*) FROM record_relationships rel WHERE rel.source_id = r.id OR rel.target_id = r.id) as connection_count
             FROM records r
             ORDER BY r.updated_at DESC",
        ).map_err(|e| format!("Prepare nodes error: {}", e))?;

        let node_rows = node_stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let title: String = row.get(1)?;
            let content: String = row.get(2)?;
            let updated_at: String = row.get(3)?;
            let connection_count: i64 = row.get(4)?;
            let preview = Self::make_preview(&content);
            Ok((id, title, preview, updated_at, connection_count))
        }).map_err(|e| format!("Query nodes error: {}", e))?;

        let mut nodes = Vec::new();
        let mut node_ids = std::collections::HashSet::new();

        for item in node_rows {
            let (id, title, preview, updated_at, connection_count) = item.map_err(|e| e.to_string())?;
            let tags = Self::get_tags_for_record(conn, &id)?;
            node_ids.insert(id.clone());
            nodes.push(GraphNode {
                id,
                title,
                preview,
                tags,
                updated_at,
                connection_count,
            });
        }

        // 2. Fetch all directed edges
        let mut edge_stmt = conn.prepare(
            "SELECT id, source_id, target_id, relation_type, description, created_at
             FROM record_relationships
             ORDER BY created_at ASC",
        ).map_err(|e| format!("Prepare edges error: {}", e))?;

        let edge_rows = edge_stmt.query_map([], |row| {
            Ok(GraphEdge {
                id: row.get(0)?,
                source: row.get(1)?,
                target: row.get(2)?,
                relation_type: row.get(3)?,
                description: row.get(4)?,
                created_at: row.get(5)?,
            })
        }).map_err(|e| format!("Query edges error: {}", e))?;

        let mut edges = Vec::new();
        for item in edge_rows {
            let edge = item.map_err(|e| e.to_string())?;
            // Ensure edge endpoints exist in the nodes set
            if node_ids.contains(&edge.source) && node_ids.contains(&edge.target) {
                edges.push(edge);
            }
        }

        Ok(KnowledgeGraphData { nodes, edges })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn test_record_lifecycle_and_search() {
        let db = Database::init_in_memory().expect("in-memory DB init failed");
        eprintln!("\n>>> DATABASE FTS5 ENABLED: {} <<<\n", db.has_fts5);
        let mut conn = db.conn.lock().unwrap();

        // 1. Create Record
        let created = KnowledgeRepository::create_record(
            &mut conn,
            CreateRecordPayload {
                title: "Epistemic Architecture in Dace".to_string(),
                content: "Knowledge records must be atomic and connected through explicit typed relationships.".to_string(),
                tags: Some(vec!["epistemology".to_string(), "architecture".to_string()]),
            },
            db.has_fts5,
        ).expect("create_record failed");

        assert_eq!(created.title, "Epistemic Architecture in Dace");
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
        let temp_dir = std::env::temp_dir().join(format!("dace_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let db_file = temp_dir.join("test_dace.db");

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

    #[test]
    fn test_fts5_synchronization_and_reopen_integrity() {
        let temp_dir = std::env::temp_dir().join(format!("dace_fts_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let db_file = temp_dir.join("fts_integrity.db");

        let id1;
        let id2;

        // Session 1: Populate records and verify initial search
        {
            let db = Database::init(&db_file).expect("session 1 init failed");
            let mut conn = db.conn.lock().unwrap();

            let rec1 = KnowledgeRepository::create_record(
                &mut conn,
                CreateRecordPayload {
                    title: "Quantum Computing Foundations".to_string(),
                    content: "Entanglement and superposition enable exponential state representation.".to_string(),
                    tags: Some(vec!["quantum".to_string(), "physics".to_string()]),
                },
                db.has_fts5,
            ).expect("create rec1 failed");
            id1 = rec1.id;

            let rec2 = KnowledgeRepository::create_record(
                &mut conn,
                CreateRecordPayload {
                    title: "Classical Neural Networks".to_string(),
                    content: "Backpropagation optimizes loss functions across deep layered architectures.".to_string(),
                    tags: Some(vec!["ai".to_string(), "machine-learning".to_string()]),
                },
                db.has_fts5,
            ).expect("create rec2 failed");
            id2 = rec2.id;

            // Search by term in rec1
            let s1 = KnowledgeRepository::search_records(&conn, "superposition", db.has_fts5).unwrap();
            assert_eq!(s1.len(), 1);
            assert_eq!(s1[0].id, id1);

            // Search by term in rec2
            let s2 = KnowledgeRepository::search_records(&conn, "backpropagation", db.has_fts5).unwrap();
            assert_eq!(s2.len(), 1);
            assert_eq!(s2[0].id, id2);

            // Update rec1 to replace "superposition" with "teleportation"
            KnowledgeRepository::update_record(
                &mut conn,
                UpdateRecordPayload {
                    id: id1.clone(),
                    title: "Quantum Information Theory".to_string(),
                    content: "Entanglement and quantum teleportation form the basis of communication protocols.".to_string(),
                    tags: Some(vec!["quantum".to_string(), "information".to_string()]),
                },
                db.has_fts5,
            ).expect("update rec1 failed");

            // Old term should no longer match
            let s_old = KnowledgeRepository::search_records(&conn, "superposition", db.has_fts5).unwrap();
            assert_eq!(s_old.len(), 0, "Old term must not match after update");

            // New term must match
            let s_new = KnowledgeRepository::search_records(&conn, "teleportation", db.has_fts5).unwrap();
            assert_eq!(s_new.len(), 1);
            assert_eq!(s_new[0].id, id1);
        }

        // Session 2: Close and reopen database - confirm FTS5 persistence
        {
            let db = Database::init(&db_file).expect("session 2 reopen failed");
            let mut conn = db.conn.lock().unwrap();

            // Search across reopened connection
            let s_reopen = KnowledgeRepository::search_records(&conn, "teleportation", db.has_fts5).unwrap();
            assert_eq!(s_reopen.len(), 1, "FTS5 index must persist after reopening database");
            assert_eq!(s_reopen[0].id, id1);

            let s_rec2 = KnowledgeRepository::search_records(&conn, "Backpropagation", db.has_fts5).unwrap();
            assert_eq!(s_rec2.len(), 1);
            assert_eq!(s_rec2[0].id, id2);

            // Delete rec2 and verify FTS5 index removes it
            let deleted = KnowledgeRepository::delete_record(&mut conn, &id2, db.has_fts5).unwrap();
            assert!(deleted);

            let s_rec2_after = KnowledgeRepository::search_records(&conn, "Backpropagation", db.has_fts5).unwrap();
            assert_eq!(s_rec2_after.len(), 0, "Deleted record must be removed from FTS5 index");
        }

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_relationships_lifecycle_and_constraints() {
        let db = Database::init_in_memory().expect("in-memory DB init failed");
        let mut conn = db.conn.lock().unwrap();

        // Create records Alpha and Beta
        let alpha = KnowledgeRepository::create_record(
            &mut conn,
            CreateRecordPayload {
                title: "Concept Alpha".to_string(),
                content: "Foundational theory of intellectual models.".to_string(),
                tags: None,
            },
            db.has_fts5,
        ).unwrap();

        let beta = KnowledgeRepository::create_record(
            &mut conn,
            CreateRecordPayload {
                title: "Concept Beta".to_string(),
                content: "Applied cognitive scaffolding based on Alpha.".to_string(),
                tags: None,
            },
            db.has_fts5,
        ).unwrap();

        // 1. Prevent self-relationship
        let self_err = KnowledgeRepository::create_relationship(
            &mut conn,
            CreateRelationshipPayload {
                source_id: alpha.id.clone(),
                target_id: alpha.id.clone(),
                relation_type: "builds_on".to_string(),
                description: None,
            },
        );
        assert!(self_err.is_err(), "Self-relationship must be rejected");
        assert!(self_err.unwrap_err().contains("cannot be related to itself"));

        // 2. Prevent invalid record references
        let invalid_err = KnowledgeRepository::create_relationship(
            &mut conn,
            CreateRelationshipPayload {
                source_id: alpha.id.clone(),
                target_id: "non-existent-uuid".to_string(),
                relation_type: "depends_on".to_string(),
                description: None,
            },
        );
        assert!(invalid_err.is_err(), "Non-existent target must be rejected");
        assert!(invalid_err.unwrap_err().contains("does not exist"));

        // 3. Create valid relationship Alpha -> Beta (builds_on)
        let rel_ab = KnowledgeRepository::create_relationship(
            &mut conn,
            CreateRelationshipPayload {
                source_id: alpha.id.clone(),
                target_id: beta.id.clone(),
                relation_type: "builds_on".to_string(),
                description: Some("Alpha provides the theoretical foundation for Beta".to_string()),
            },
        ).expect("create relationship Alpha -> Beta failed");

        assert_eq!(rel_ab.source_id, alpha.id);
        assert_eq!(rel_ab.source_title, "Concept Alpha");
        assert_eq!(rel_ab.target_id, beta.id);
        assert_eq!(rel_ab.target_title, "Concept Beta");
        assert_eq!(rel_ab.relation_type, "builds_on");
        assert_eq!(
            rel_ab.description,
            Some("Alpha provides the theoretical foundation for Beta".to_string())
        );

        // 4. Duplicate relationship prevention
        let dup_err = KnowledgeRepository::create_relationship(
            &mut conn,
            CreateRelationshipPayload {
                source_id: alpha.id.clone(),
                target_id: beta.id.clone(),
                relation_type: "builds_on".to_string(),
                description: Some("Duplicate attempt".to_string()),
            },
        );
        assert!(dup_err.is_err(), "Duplicate relationship must be rejected");
        assert!(dup_err.unwrap_err().contains("already exists"));

        // 5. Deliberate reciprocal / directed relationship Beta -> Alpha (explains)
        let rel_ba = KnowledgeRepository::create_relationship(
            &mut conn,
            CreateRelationshipPayload {
                source_id: beta.id.clone(),
                target_id: alpha.id.clone(),
                relation_type: "explains".to_string(),
                description: Some("Concrete realization illustrating Alpha".to_string()),
            },
        ).expect("create reciprocal Beta -> Alpha failed");

        assert_eq!(rel_ba.source_id, beta.id);
        assert_eq!(rel_ba.target_id, alpha.id);
        assert_eq!(rel_ba.relation_type, "explains");

        // 6. Query incoming and outgoing for Alpha
        let alpha_rels = KnowledgeRepository::get_record_relationships(&conn, &alpha.id)
            .expect("get relationships for Alpha failed");
        assert_eq!(alpha_rels.outgoing.len(), 1, "Alpha must have 1 outgoing relationship");
        assert_eq!(alpha_rels.outgoing[0].target_id, beta.id);
        assert_eq!(alpha_rels.outgoing[0].relation_type, "builds_on");
        assert_eq!(alpha_rels.incoming.len(), 1, "Alpha must have 1 incoming relationship");
        assert_eq!(alpha_rels.incoming[0].source_id, beta.id);
        assert_eq!(alpha_rels.incoming[0].relation_type, "explains");

        // Query incoming and outgoing for Beta
        let beta_rels = KnowledgeRepository::get_record_relationships(&conn, &beta.id)
            .expect("get relationships for Beta failed");
        assert_eq!(beta_rels.outgoing.len(), 1);
        assert_eq!(beta_rels.outgoing[0].target_id, alpha.id);
        assert_eq!(beta_rels.incoming.len(), 1);
        assert_eq!(beta_rels.incoming[0].source_id, alpha.id);

        // 7. Relationship deletion
        let del_rel = KnowledgeRepository::delete_relationship(&mut conn, &rel_ba.id)
            .expect("delete relationship failed");
        assert!(del_rel);

        let alpha_after_del = KnowledgeRepository::get_record_relationships(&conn, &alpha.id).unwrap();
        assert_eq!(alpha_after_del.incoming.len(), 0, "Incoming rel to Alpha should be gone");
        assert_eq!(alpha_after_del.outgoing.len(), 1, "Outgoing rel from Alpha must remain");

        // 8. Record deletion and referential cascade
        let del_beta = KnowledgeRepository::delete_record(&mut conn, &beta.id, db.has_fts5).unwrap();
        assert!(del_beta);

        let alpha_after_cascade = KnowledgeRepository::get_record_relationships(&conn, &alpha.id).unwrap();
        assert_eq!(
            alpha_after_cascade.outgoing.len(),
            0,
            "Relationships referencing deleted record must be cascaded"
        );
    }

    #[test]
    fn test_relationship_persistence_across_restarts() {
        let temp_dir = std::env::temp_dir().join(format!("dace_rel_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let db_file = temp_dir.join("rel_persist.db");

        let id_c;
        let id_d;

        // Session 1: Create records and relationship, flush to disk, close DB
        {
            let db = Database::init(&db_file).expect("session 1 init failed");
            let mut conn = db.conn.lock().unwrap();

            let rec_c = KnowledgeRepository::create_record(
                &mut conn,
                CreateRecordPayload {
                    title: "Concept Gamma".to_string(),
                    content: "Source node".to_string(),
                    tags: None,
                },
                db.has_fts5,
            ).unwrap();
            id_c = rec_c.id;

            let rec_d = KnowledgeRepository::create_record(
                &mut conn,
                CreateRecordPayload {
                    title: "Concept Delta".to_string(),
                    content: "Target node".to_string(),
                    tags: None,
                },
                db.has_fts5,
            ).unwrap();
            id_d = rec_d.id;

            KnowledgeRepository::create_relationship(
                &mut conn,
                CreateRelationshipPayload {
                    source_id: id_c.clone(),
                    target_id: id_d.clone(),
                    relation_type: "depends_on".to_string(),
                    description: Some("Gamma cannot function without Delta".to_string()),
                },
            ).expect("create relationship failed");
        }

        // Session 2: Reopen database and verify relationships persisted on disk
        {
            let db = Database::init(&db_file).expect("session 2 reopen failed");
            let conn = db.conn.lock().unwrap();

            let c_rels = KnowledgeRepository::get_record_relationships(&conn, &id_c).unwrap();
            assert_eq!(c_rels.outgoing.len(), 1, "Outgoing relationship must persist across reopen");
            assert_eq!(c_rels.outgoing[0].target_id, id_d);
            assert_eq!(c_rels.outgoing[0].target_title, "Concept Delta");
            assert_eq!(c_rels.outgoing[0].relation_type, "depends_on");
            assert_eq!(
                c_rels.outgoing[0].description,
                Some("Gamma cannot function without Delta".to_string())
            );

            let d_rels = KnowledgeRepository::get_record_relationships(&conn, &id_d).unwrap();
            assert_eq!(d_rels.incoming.len(), 1, "Incoming relationship must persist across reopen");
            assert_eq!(d_rels.incoming[0].source_id, id_c);
            assert_eq!(d_rels.incoming[0].source_title, "Concept Gamma");
            assert_eq!(d_rels.incoming[0].relation_type, "depends_on");
        }

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn test_knowledge_graph_data_retrieval() {
        let db = Database::init_in_memory().expect("in-memory DB init failed");
        let mut conn = db.conn.lock().unwrap();

        // 1. Empty database handling
        let empty_graph = KnowledgeRepository::get_knowledge_graph(&conn).unwrap();
        assert_eq!(empty_graph.nodes.len(), 0);
        assert_eq!(empty_graph.edges.len(), 0);

        // 2. Disconnected node handling
        let solo = KnowledgeRepository::create_record(
            &mut conn,
            CreateRecordPayload {
                title: "Island Concept".to_string(),
                content: "A standalone concept without connections.".to_string(),
                tags: Some(vec!["isolated".to_string()]),
            },
            db.has_fts5,
        ).unwrap();

        let solo_graph = KnowledgeRepository::get_knowledge_graph(&conn).unwrap();
        assert_eq!(solo_graph.nodes.len(), 1);
        assert_eq!(solo_graph.nodes[0].id, solo.id);
        assert_eq!(solo_graph.nodes[0].title, "Island Concept");
        assert_eq!(solo_graph.nodes[0].connection_count, 0);
        assert_eq!(solo_graph.edges.len(), 0);

        // 3. Cycle handling (A -> B -> C -> A)
        let node_a = KnowledgeRepository::create_record(
            &mut conn,
            CreateRecordPayload {
                title: "Node A".to_string(),
                content: "First vertex in cycle".to_string(),
                tags: None,
            },
            db.has_fts5,
        ).unwrap();

        let node_b = KnowledgeRepository::create_record(
            &mut conn,
            CreateRecordPayload {
                title: "Node B".to_string(),
                content: "Second vertex in cycle".to_string(),
                tags: None,
            },
            db.has_fts5,
        ).unwrap();

        let node_c = KnowledgeRepository::create_record(
            &mut conn,
            CreateRecordPayload {
                title: "Node C".to_string(),
                content: "Third vertex in cycle".to_string(),
                tags: None,
            },
            db.has_fts5,
        ).unwrap();

        // Relate A -> B
        KnowledgeRepository::create_relationship(
            &mut conn,
            CreateRelationshipPayload {
                source_id: node_a.id.clone(),
                target_id: node_b.id.clone(),
                relation_type: "builds_on".to_string(),
                description: Some("A to B".to_string()),
            },
        ).unwrap();

        // Relate B -> C
        KnowledgeRepository::create_relationship(
            &mut conn,
            CreateRelationshipPayload {
                source_id: node_b.id.clone(),
                target_id: node_c.id.clone(),
                relation_type: "explains".to_string(),
                description: Some("B to C".to_string()),
            },
        ).unwrap();

        // Relate C -> A (closes cycle)
        KnowledgeRepository::create_relationship(
            &mut conn,
            CreateRelationshipPayload {
                source_id: node_c.id.clone(),
                target_id: node_a.id.clone(),
                relation_type: "depends_on".to_string(),
                description: Some("C back to A".to_string()),
            },
        ).unwrap();

        let cyclic_graph = KnowledgeRepository::get_knowledge_graph(&conn).unwrap();
        // 4 nodes total (solo, A, B, C)
        assert_eq!(cyclic_graph.nodes.len(), 4);
        assert_eq!(cyclic_graph.edges.len(), 3);

        let a_meta = cyclic_graph.nodes.iter().find(|n| n.id == node_a.id).unwrap();
        assert_eq!(a_meta.connection_count, 2); // 1 outgoing (A->B) + 1 incoming (C->A)

        // Verify directed edges preserved
        let edge_ab = cyclic_graph.edges.iter().find(|e| e.source == node_a.id && e.target == node_b.id).unwrap();
        assert_eq!(edge_ab.relation_type, "builds_on");
        assert_eq!(edge_ab.description, Some("A to B".to_string()));
    }
}
