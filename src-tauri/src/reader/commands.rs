use tauri::State;
use crate::db::Database;
use crate::knowledge::models::KnowledgeRecord;
use super::models::{
    Annotation, CreateHighlightInput, CreateRecordFromExcerptInput, ExcerptCitation, Highlight,
    HighlightRecordLink, LinkHighlightToRecordInput, UpdateAnnotationInput,
};
use super::repository::ReaderRepository;

#[tauri::command]
pub fn create_highlight(
    db: State<'_, Database>,
    input: CreateHighlightInput,
) -> Result<Highlight, String> {
    let mut conn = db
        .conn
        .lock()
        .map_err(|e| format!("Database lock poisoned: {}", e))?;
    ReaderRepository::create_highlight(&mut conn, input)
}

#[tauri::command]
pub fn get_attachment_highlights(
    db: State<'_, Database>,
    attachment_id: String,
) -> Result<Vec<Highlight>, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("Database lock poisoned: {}", e))?;
    ReaderRepository::get_attachment_highlights(&conn, &attachment_id)
}

#[tauri::command]
pub fn update_highlight_type(
    db: State<'_, Database>,
    highlight_id: String,
    highlight_type: String,
    color: Option<String>,
) -> Result<(), String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("Database lock poisoned: {}", e))?;
    ReaderRepository::update_highlight_type(&conn, &highlight_id, &highlight_type, color)
}

#[tauri::command]
pub fn delete_highlight(
    db: State<'_, Database>,
    highlight_id: String,
) -> Result<(), String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("Database lock poisoned: {}", e))?;
    ReaderRepository::delete_highlight(&conn, &highlight_id)
}

#[tauri::command]
pub fn save_annotation(
    db: State<'_, Database>,
    input: UpdateAnnotationInput,
) -> Result<Annotation, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("Database lock poisoned: {}", e))?;
    ReaderRepository::save_annotation(&conn, &input.highlight_id, &input.content)
}

#[tauri::command]
pub fn delete_annotation(
    db: State<'_, Database>,
    highlight_id: String,
) -> Result<(), String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("Database lock poisoned: {}", e))?;
    ReaderRepository::delete_annotation(&conn, &highlight_id)
}

#[tauri::command]
pub fn link_highlight_to_record(
    db: State<'_, Database>,
    input: LinkHighlightToRecordInput,
) -> Result<(), String> {
    let mut conn = db
        .conn
        .lock()
        .map_err(|e| format!("Database lock poisoned: {}", e))?;
    ReaderRepository::link_highlight_to_record(
        &mut conn,
        &input.highlight_id,
        &input.record_id,
        input.commentary,
    )
}

#[tauri::command]
pub fn unlink_highlight_from_record(
    db: State<'_, Database>,
    highlight_id: String,
    record_id: String,
) -> Result<(), String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("Database lock poisoned: {}", e))?;
    ReaderRepository::unlink_highlight_from_record(&conn, &highlight_id, &record_id)
}

#[tauri::command]
pub fn get_record_excerpts(
    db: State<'_, Database>,
    record_id: String,
) -> Result<Vec<ExcerptCitation>, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("Database lock poisoned: {}", e))?;
    ReaderRepository::get_record_excerpts(&conn, &record_id)
}

#[tauri::command]
pub fn get_highlight_records(
    db: State<'_, Database>,
    highlight_id: String,
) -> Result<Vec<HighlightRecordLink>, String> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| format!("Database lock poisoned: {}", e))?;
    ReaderRepository::get_highlight_records(&conn, &highlight_id)
}

#[tauri::command]
pub fn create_record_from_excerpt(
    db: State<'_, Database>,
    input: CreateRecordFromExcerptInput,
) -> Result<KnowledgeRecord, String> {
    let has_fts5 = db.has_fts5;
    let mut conn = db
        .conn
        .lock()
        .map_err(|e| format!("Database lock poisoned: {}", e))?;
    ReaderRepository::create_record_from_excerpt(
        &mut conn,
        &input.highlight_id,
        &input.title,
        input.commentary,
        has_fts5,
    )
}
