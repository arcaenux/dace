use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub file_name: String,
    pub mime_type: String,
    pub file_size: i64,
    pub sha256_hash: String,
    pub storage_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentSummary {
    pub id: String,
    pub file_name: String,
    pub mime_type: String,
    pub file_size: i64,
    pub sha256_hash: String,
    pub created_at: String,
    pub record_count: i64,
    pub file_exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentDetails {
    pub id: String,
    pub file_name: String,
    pub mime_type: String,
    pub file_size: i64,
    pub sha256_hash: String,
    pub storage_path: String,
    pub created_at: String,
    pub updated_at: String,
    pub file_exists: bool,
    pub integrity_ok: bool,
    pub associated_records: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportAttachmentResult {
    pub attachment: AttachmentSummary,
    pub is_duplicate: bool,
    pub associated_record_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StoredFileInfo {
    pub relative_path: String,
    pub sha256_hash: String,
    pub file_size: u64,
    pub was_deduplicated: bool,
}
