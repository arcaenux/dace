use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Highlight {
    pub id: String,
    pub attachment_id: String,
    pub doc_sha256: String,
    pub page_number: i32,
    pub selected_text: String,
    pub anchor_data: String,
    pub highlight_type: String, // "important" | "question" | "insight" | "definition"
    pub color: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub is_stale: bool,
    pub annotation: Option<Annotation>,
    pub linked_record_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Annotation {
    pub id: String,
    pub highlight_id: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HighlightRecordLink {
    pub highlight_id: String,
    pub record_id: String,
    pub record_title: String,
    pub commentary: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExcerptCitation {
    pub highlight_id: String,
    pub attachment_id: String,
    pub document_title: String,
    pub page_number: i32,
    pub selected_text: String,
    pub highlight_type: String,
    pub commentary: Option<String>,
    pub created_at: String,
    pub is_stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateHighlightInput {
    pub attachment_id: String,
    pub page_number: i32,
    pub selected_text: String,
    pub anchor_data: String,
    pub highlight_type: String,
    pub color: Option<String>,
    pub annotation_content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateAnnotationInput {
    pub highlight_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkHighlightToRecordInput {
    pub highlight_id: String,
    pub record_id: String,
    pub commentary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRecordFromExcerptInput {
    pub highlight_id: String,
    pub title: String,
    pub commentary: Option<String>,
}
