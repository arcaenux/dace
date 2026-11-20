#[cfg(test)]
mod tests {
    use crate::db::Database;
    use crate::knowledge::models::CreateRecordPayload;
    use crate::knowledge::repository::KnowledgeRepository;
    use crate::reader::models::CreateHighlightInput;
    use crate::reader::repository::ReaderRepository;
    use rusqlite::params;
    use uuid::Uuid;

    fn setup_test_db() -> Database {
        Database::init_in_memory().expect("In-memory DB init failed")
    }

    fn insert_test_attachment(db: &Database, file_name: &str, sha: &str) -> String {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO attachments (id, file_name, mime_type, file_size, sha256_hash, storage_path, created_at, updated_at)
             VALUES (?1, ?2, 'application/pdf', 1024, ?3, 'attachments/ab/test.pdf', ?4, ?4)",
            params![id, file_name, sha, now],
        ).unwrap();
        id
    }

    #[test]
    fn test_highlight_crud_and_annotations() {
        let db = setup_test_db();
        let att_id = insert_test_attachment(&db, "quantum_foundations.pdf", "sha256_abc123");

        let mut conn = db.conn.lock().unwrap();

        // 1. Create highlight with initial annotation
        let input = CreateHighlightInput {
            attachment_id: att_id.clone(),
            page_number: 4,
            selected_text: "Wavefunction collapse is non-local and instantaneous.".to_string(),
            anchor_data: r#"{"prefix":"Remarkably, ","suffix":", challenging realism.","startOffset":120,"endOffset":173}"#.to_string(),
            highlight_type: "insight".to_string(),
            color: Some("#10b981".to_string()),
            annotation_content: Some("Critical reference for Bell inequality discussions.".to_string()),
        };

        let hl = ReaderRepository::create_highlight(&mut conn, input).expect("Highlight creation failed");
        assert_eq!(hl.page_number, 4);
        assert_eq!(hl.highlight_type, "insight");
        assert!(!hl.is_stale);
        assert!(hl.annotation.is_some());
        assert_eq!(
            hl.annotation.as_ref().unwrap().content,
            "Critical reference for Bell inequality discussions."
        );

        // 2. Query highlights
        let list = ReaderRepository::get_attachment_highlights(&conn, &att_id).expect("Fetch highlights failed");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, hl.id);
        assert_eq!(list[0].selected_text, "Wavefunction collapse is non-local and instantaneous.");

        // 3. Update highlight type
        ReaderRepository::update_highlight_type(&conn, &hl.id, "important", Some("#f59e0b".to_string()))
            .expect("Update highlight type failed");

        let updated_list = ReaderRepository::get_attachment_highlights(&conn, &att_id).unwrap();
        assert_eq!(updated_list[0].highlight_type, "important");

        // 4. Update annotation
        let ann2 = ReaderRepository::save_annotation(&conn, &hl.id, "Updated reflection: review Aspect experiments.")
            .expect("Update annotation failed");
        assert_eq!(ann2.content, "Updated reflection: review Aspect experiments.");

        // 5. Delete annotation
        ReaderRepository::delete_annotation(&conn, &hl.id).expect("Delete annotation failed");
        let list_after_ann_del = ReaderRepository::get_attachment_highlights(&conn, &att_id).unwrap();
        assert!(list_after_ann_del[0].annotation.is_none());

        // 6. Delete highlight
        ReaderRepository::delete_highlight(&conn, &hl.id).expect("Delete highlight failed");
        let list_empty = ReaderRepository::get_attachment_highlights(&conn, &att_id).unwrap();
        assert_eq!(list_empty.len(), 0);
    }

    #[test]
    fn test_highlight_and_annotation_persist_across_reopen() {
        let dir = std::env::temp_dir().join(format!("dace-reader-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("library.db");

        let att_id = {
            let db = Database::init(&db_path).expect("Could not create on-disk database");
            let id = insert_test_attachment(&db, "persistence.pdf", "sha_persist_1");
            let mut conn = db.conn.lock().unwrap();
            let input = CreateHighlightInput {
                attachment_id: id.clone(),
                page_number: 6,
                selected_text: "Measured values remain stable across runs.".to_string(),
                anchor_data: r#"{"pageNumber":6,"startOffset":4,"endOffset":44}"#.to_string(),
                highlight_type: "important".to_string(),
                color: None,
                annotation_content: Some("Re-check calibration table.".to_string()),
            };
            let hl = ReaderRepository::create_highlight(&mut conn, input).unwrap();
            ReaderRepository::save_annotation(&mut conn, &hl.id, "Final reflection after review.")
                .expect("Could not update annotation");
            drop(conn);
            id
        };

        {
            let db = Database::init(&db_path).expect("Could not reopen database");
            let conn = db.conn.lock().unwrap();
            let highlights = ReaderRepository::get_attachment_highlights(&conn, &att_id).unwrap();
            assert_eq!(highlights.len(), 1);
            assert_eq!(highlights[0].page_number, 6);
            assert_eq!(highlights[0].selected_text, "Measured values remain stable across runs.");
            assert_eq!(
                highlights[0].annotation.as_ref().unwrap().content,
                "Final reflection after review."
            );
        }

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn test_stale_anchor_detection_on_checksum_mismatch() {
        let db = setup_test_db();
        let att_id = insert_test_attachment(&db, "relativity.pdf", "original_sha_111");

        let mut conn = db.conn.lock().unwrap();

        let input = CreateHighlightInput {
            attachment_id: att_id.clone(),
            page_number: 12,
            selected_text: "Spacetime curvature dictates geodesic motion.".to_string(),
            anchor_data: r#"{"startOffset":10,"endOffset":55}"#.to_string(),
            highlight_type: "definition".to_string(),
            color: None,
            annotation_content: None,
        };

        let hl = ReaderRepository::create_highlight(&mut conn, input).unwrap();
        assert!(!hl.is_stale);

        // Simulate attachment updated with a new document version (new checksum)
        conn.execute(
            "UPDATE attachments SET sha256_hash = 'modified_sha_222' WHERE id = ?1",
            params![att_id],
        ).unwrap();

        // Query highlights again: should detect stale anchor!
        let list = ReaderRepository::get_attachment_highlights(&conn, &att_id).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].is_stale, "Expected highlight to be flagged as stale anchor when attachment SHA changes");
    }

    #[test]
    fn test_knowledge_record_linkage_and_excerpt_creation() {
        let db = setup_test_db();
        let att_id = insert_test_attachment(&db, "newton_principia.pdf", "sha_newton");

        let mut conn = db.conn.lock().unwrap();

        // Create highlight
        let input = CreateHighlightInput {
            attachment_id: att_id.clone(),
            page_number: 1,
            selected_text: "Every body perseveres in its state of rest, or of uniform motion in a right line...".to_string(),
            anchor_data: r#"{"startOffset":0,"endOffset":83}"#.to_string(),
            highlight_type: "important".to_string(),
            color: None,
            annotation_content: None,
        };
        let hl = ReaderRepository::create_highlight(&mut conn, input).unwrap();

        // 1. Create a new knowledge record from this excerpt
        let rec = ReaderRepository::create_record_from_excerpt(
            &mut conn,
            &hl.id,
            "Newton's First Law of Motion",
            Some("Foundational postulate for classical dynamics.".to_string()),
            db.has_fts5,
        ).expect("Create record from excerpt failed");

        assert_eq!(rec.title, "Newton's First Law of Motion");
        assert!(rec.content.contains("Every body perseveres"));
        assert!(rec.content.contains("newton_principia.pdf"));

        // Verify highlight_records was created
        let links = ReaderRepository::get_highlight_records(&conn, &hl.id).unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].record_id, rec.id);

        // Verify record excerpts
        let citations = ReaderRepository::get_record_excerpts(&conn, &rec.id).unwrap();
        assert_eq!(citations.len(), 1);
        assert_eq!(citations[0].document_title, "newton_principia.pdf");
        assert_eq!(citations[0].page_number, 1);
        assert!(!citations[0].is_stale);

        // Verify record_attachments junction was populated
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM record_attachments WHERE record_id = ?1 AND attachment_id = ?2",
            params![rec.id, att_id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 1);

        // 2. Link highlight to another existing record
        let rec2 = KnowledgeRepository::create_record(
            &mut conn,
            CreateRecordPayload {
                title: "Inertial Reference Frames".to_string(),
                content: "Discussion on frames where Newton's laws hold.".to_string(),
                tags: Some(vec!["physics".to_string()]),
            },
            db.has_fts5,
        ).unwrap();

        ReaderRepository::link_highlight_to_record(
            &mut conn,
            &hl.id,
            &rec2.id,
            Some("Secondary cross-reference".to_string()),
        ).expect("Linking to second record failed");

        let links2 = ReaderRepository::get_highlight_records(&conn, &hl.id).unwrap();
        assert_eq!(links2.len(), 2);

        // 3. Unlink from rec2
        ReaderRepository::unlink_highlight_from_record(&conn, &hl.id, &rec2.id).unwrap();
        let links3 = ReaderRepository::get_highlight_records(&conn, &hl.id).unwrap();
        assert_eq!(links3.len(), 1);

        // 4. Test cascade: Deleting record removes row from highlight_records, but preserves highlight!
        conn.execute("DELETE FROM records WHERE id = ?1", params![rec.id]).unwrap();
        let links_after_rec_del = ReaderRepository::get_highlight_records(&conn, &hl.id).unwrap();
        assert_eq!(links_after_rec_del.len(), 0);

        let hl_check = ReaderRepository::get_attachment_highlights(&conn, &att_id).unwrap();
        assert_eq!(hl_check.len(), 1, "Highlight should be preserved when record is deleted");

        // 5. Test cascade: Deleting attachment removes highlight and annotations
        conn.execute("DELETE FROM attachments WHERE id = ?1", params![att_id]).unwrap();
        let hl_after_att_del = ReaderRepository::get_attachment_highlights(&conn, &att_id).unwrap();
        assert_eq!(hl_after_att_del.len(), 0, "Highlight should cascade delete when attachment is deleted");
    }
}
