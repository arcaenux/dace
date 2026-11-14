use tauri::State;
use crate::db::Database;
use super::models::{
    CreateRecordPayload, CreateRelationshipPayload, KnowledgeRecord, KnowledgeRecordSummary,
    RecordRelationshipItem, RecordRelationshipsResponse, TagItem, UpdateRecordPayload,
};
use super::repository::KnowledgeRepository;

#[tauri::command]
pub fn create_record(
    db: State<'_, Database>,
    payload: CreateRecordPayload,
) -> Result<KnowledgeRecord, String> {
    let mut conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    KnowledgeRepository::create_record(&mut conn, payload, db.has_fts5)
}

#[tauri::command]
pub fn get_record(
    db: State<'_, Database>,
    id: String,
) -> Result<Option<KnowledgeRecord>, String> {
    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    KnowledgeRepository::get_record(&conn, &id)
}

#[tauri::command]
pub fn list_records(
    db: State<'_, Database>,
    tag: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<KnowledgeRecordSummary>, String> {
    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    KnowledgeRepository::list_records(&conn, tag, limit, offset)
}

#[tauri::command]
pub fn update_record(
    db: State<'_, Database>,
    payload: UpdateRecordPayload,
) -> Result<KnowledgeRecord, String> {
    let mut conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    KnowledgeRepository::update_record(&mut conn, payload, db.has_fts5)
}

#[tauri::command]
pub fn delete_record(
    db: State<'_, Database>,
    id: String,
) -> Result<bool, String> {
    let mut conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    KnowledgeRepository::delete_record(&mut conn, &id, db.has_fts5)
}

#[tauri::command]
pub fn search_records(
    db: State<'_, Database>,
    query: String,
) -> Result<Vec<KnowledgeRecordSummary>, String> {
    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    KnowledgeRepository::search_records(&conn, &query, db.has_fts5)
}

#[tauri::command]
pub fn list_tags(
    db: State<'_, Database>,
) -> Result<Vec<TagItem>, String> {
    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    KnowledgeRepository::list_tags(&conn)
}

#[tauri::command]
pub fn create_relationship(
    db: State<'_, Database>,
    payload: CreateRelationshipPayload,
) -> Result<RecordRelationshipItem, String> {
    let mut conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    KnowledgeRepository::create_relationship(&mut conn, payload)
}

#[tauri::command]
pub fn delete_relationship(
    db: State<'_, Database>,
    id: String,
) -> Result<bool, String> {
    let mut conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    KnowledgeRepository::delete_relationship(&mut conn, &id)
}

#[tauri::command]
pub fn get_record_relationships(
    db: State<'_, Database>,
    record_id: String,
) -> Result<RecordRelationshipsResponse, String> {
    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    KnowledgeRepository::get_record_relationships(&conn, &record_id)
}
