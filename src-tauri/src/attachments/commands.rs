use std::fs::File;
use std::path::Path;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::db::Database;
use super::models::{
    AttachmentDetails, AttachmentSummary, ImportAttachmentResult,
};
use super::repository::AttachmentRepository;
use super::storage::{infer_mime_type, AttachmentStorage};

fn base64_encode(data: &[u8]) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };

        result.push(CHARSET[(b0 >> 2) as usize] as char);
        result.push(CHARSET[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARSET[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARSET[(b2 & 0x3f) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

#[tauri::command]
pub fn pick_and_import_attachment(
    db: State<'_, Database>,
    storage: State<'_, AttachmentStorage>,
    record_id: Option<String>,
) -> Result<Option<ImportAttachmentResult>, String> {
    // 1. Invoke native OS file picker
    let file_handle = rfd::FileDialog::new()
        .set_title("Import Document into NOVA DOME")
        .add_filter("Research Documents & Images", &["pdf", "md", "txt", "png", "jpg", "jpeg", "webp", "gif", "svg"])
        .add_filter("All Files", &["*"])
        .pick_file();

    let Some(source_path) = file_handle else {
        return Ok(None);
    };

    let result = import_file_internal(&db, &storage, &source_path, record_id.as_deref())?;
    Ok(Some(result))
}

#[tauri::command]
pub fn import_attachment_from_path(
    db: State<'_, Database>,
    storage: State<'_, AttachmentStorage>,
    source_path: String,
    record_id: Option<String>,
) -> Result<ImportAttachmentResult, String> {
    let path = Path::new(&source_path);
    if !path.exists() {
        return Err(format!("Source file does not exist: {}", source_path));
    }
    import_file_internal(&db, &storage, path, record_id.as_deref())
}

#[tauri::command]
pub fn import_attachment_from_bytes(
    db: State<'_, Database>,
    storage: State<'_, AttachmentStorage>,
    file_name: String,
    data: Vec<u8>,
    record_id: Option<String>,
) -> Result<ImportAttachmentResult, String> {
    let mut cursor = std::io::Cursor::new(&data);
    let stored = storage.stage_and_store(&mut cursor, &file_name)?;

    let sample_slice = if data.len() >= 16 { Some(&data[..16]) } else { Some(&data[..]) };
    let mime_type = infer_mime_type(&file_name, sample_slice);

    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    let (att, is_duplicate) = AttachmentRepository::create_or_reuse_attachment(
        &conn,
        &file_name,
        mime_type,
        stored.file_size as i64,
        &stored.sha256_hash,
        &stored.relative_path,
        record_id.as_deref(),
    )?;

    Ok(ImportAttachmentResult {
        attachment: AttachmentSummary {
            id: att.id,
            file_name: att.file_name,
            mime_type: att.mime_type,
            file_size: att.file_size,
            sha256_hash: att.sha256_hash,
            created_at: att.created_at,
            record_count: if record_id.is_some() { 1 } else { 0 },
            file_exists: true,
        },
        is_duplicate,
        associated_record_id: record_id,
    })
}

fn import_file_internal(
    db: &State<'_, Database>,
    storage: &State<'_, AttachmentStorage>,
    source_path: &Path,
    record_id: Option<&str>,
) -> Result<ImportAttachmentResult, String> {
    let original_name = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document.bin")
        .to_string();

    let mut file = File::open(source_path)
        .map_err(|e| format!("Failed to open file {:?}: {}", source_path, e))?;

    let stored = storage.stage_and_store(&mut file, &original_name)?;

    // Sniff first few bytes for MIME verification
    let mut header_buf = [0u8; 16];
    let sample = if let Ok(mut f) = File::open(storage.resolve_path(&stored.relative_path)?) {
        use std::io::Read;
        let n = f.read(&mut header_buf).unwrap_or(0);
        if n > 0 { Some(&header_buf[..n]) } else { None }
    } else {
        None
    };

    let mime_type = infer_mime_type(&original_name, sample);

    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    let (att, is_duplicate) = AttachmentRepository::create_or_reuse_attachment(
        &conn,
        &original_name,
        mime_type,
        stored.file_size as i64,
        &stored.sha256_hash,
        &stored.relative_path,
        record_id,
    )?;

    Ok(ImportAttachmentResult {
        attachment: AttachmentSummary {
            id: att.id,
            file_name: att.file_name,
            mime_type: att.mime_type,
            file_size: att.file_size,
            sha256_hash: att.sha256_hash,
            created_at: att.created_at,
            record_count: if record_id.is_some() { 1 } else { 0 },
            file_exists: true,
        },
        is_duplicate,
        associated_record_id: record_id.map(|s| s.to_string()),
    })
}

#[tauri::command]
pub fn get_record_attachments(
    db: State<'_, Database>,
    storage: State<'_, AttachmentStorage>,
    record_id: String,
) -> Result<Vec<AttachmentSummary>, String> {
    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    let mut list = AttachmentRepository::list_record_attachments(&conn, &record_id)?;

    // Verify file physical presence on disk
    for item in &mut list {
        if let Ok(Some(full)) = AttachmentRepository::get_attachment(&conn, &item.id) {
            let (exists, _) = storage.verify_integrity(&full.storage_path, &full.sha256_hash);
            item.file_exists = exists;
        }
    }

    Ok(list)
}

#[tauri::command]
pub fn list_all_attachments(
    db: State<'_, Database>,
    storage: State<'_, AttachmentStorage>,
) -> Result<Vec<AttachmentSummary>, String> {
    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    let mut list = AttachmentRepository::list_all_attachments(&conn)?;

    for item in &mut list {
        if let Ok(Some(full)) = AttachmentRepository::get_attachment(&conn, &item.id) {
            let (exists, _) = storage.verify_integrity(&full.storage_path, &full.sha256_hash);
            item.file_exists = exists;
        }
    }

    Ok(list)
}

#[tauri::command]
pub fn get_attachment_details(
    db: State<'_, Database>,
    storage: State<'_, AttachmentStorage>,
    attachment_id: String,
) -> Result<AttachmentDetails, String> {
    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    let att = AttachmentRepository::get_attachment(&conn, &attachment_id)?
        .ok_or_else(|| format!("Attachment {} not found", attachment_id))?;

    let (file_exists, integrity_ok) = storage.verify_integrity(&att.storage_path, &att.sha256_hash);
    let associated_records = AttachmentRepository::get_associated_records(&conn, &attachment_id)?;

    Ok(AttachmentDetails {
        id: att.id,
        file_name: att.file_name,
        mime_type: att.mime_type,
        file_size: att.file_size,
        sha256_hash: att.sha256_hash,
        storage_path: att.storage_path,
        created_at: att.created_at,
        updated_at: att.updated_at,
        file_exists,
        integrity_ok,
        associated_records,
    })
}

#[tauri::command]
pub fn associate_attachment_with_record(
    db: State<'_, Database>,
    record_id: String,
    attachment_id: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    AttachmentRepository::associate_attachment(&conn, &record_id, &attachment_id)
}

#[tauri::command]
pub fn disassociate_attachment_from_record(
    db: State<'_, Database>,
    record_id: String,
    attachment_id: String,
) -> Result<bool, String> {
    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    AttachmentRepository::disassociate_attachment(&conn, &record_id, &attachment_id)
}

#[tauri::command]
pub fn delete_attachment(
    db: State<'_, Database>,
    storage: State<'_, AttachmentStorage>,
    attachment_id: String,
) -> Result<bool, String> {
    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    let (relative_path, can_delete_physical) =
        AttachmentRepository::delete_attachment(&conn, &attachment_id)?;

    if can_delete_physical {
        let _ = storage.delete_file(&relative_path);
    }

    Ok(true)
}

#[tauri::command]
pub fn read_attachment_text(
    db: State<'_, Database>,
    storage: State<'_, AttachmentStorage>,
    attachment_id: String,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    let att = AttachmentRepository::get_attachment(&conn, &attachment_id)?
        .ok_or_else(|| format!("Attachment {} not found", attachment_id))?;

    // Limit text reading to 2 MB to preserve memory
    storage.read_text(&att.storage_path, 2 * 1024 * 1024)
}

#[tauri::command]
pub fn read_attachment_data_url(
    db: State<'_, Database>,
    storage: State<'_, AttachmentStorage>,
    attachment_id: String,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    let att = AttachmentRepository::get_attachment(&conn, &attachment_id)?
        .ok_or_else(|| format!("Attachment {} not found", attachment_id))?;

    // Limit byte reading to 15 MB for in-app data URL viewing
    let bytes = storage.read_bytes(&att.storage_path, 15 * 1024 * 1024)?;
    let encoded = base64_encode(&bytes);
    Ok(format!("data:{};base64,{}", att.mime_type, encoded))
}

#[tauri::command]
pub fn open_attachment_in_system(
    app: AppHandle,
    db: State<'_, Database>,
    storage: State<'_, AttachmentStorage>,
    attachment_id: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| format!("Mutex lock error: {}", e))?;
    let att = AttachmentRepository::get_attachment(&conn, &attachment_id)?
        .ok_or_else(|| format!("Attachment {} not found", attachment_id))?;

    let full_path = storage.resolve_path(&att.storage_path)?;
    if !full_path.exists() {
        return Err(format!("Managed file does not exist on disk: {}", att.storage_path));
    }

    let path_str = full_path
        .to_str()
        .ok_or_else(|| "Invalid unicode in file path".to_string())?;

    app.opener()
        .open_path(path_str, None::<&str>)
        .map_err(|e| format!("Failed to open file in system application: {}", e))?;

    Ok(())
}
