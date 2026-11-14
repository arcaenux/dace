use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeRecord {
    pub id: String,
    pub title: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeRecordSummary {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRecordPayload {
    pub title: String,
    pub content: String,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRecordPayload {
    pub id: String,
    pub title: String,
    pub content: String,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagItem {
    pub id: String,
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordRelationship {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub relation_type: String,
    pub description: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordRelationshipItem {
    pub id: String,
    pub source_id: String,
    pub source_title: String,
    pub target_id: String,
    pub target_title: String,
    pub relation_type: String,
    pub description: Option<String>,
    pub created_at: String,
    pub is_outgoing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordRelationshipsResponse {
    pub outgoing: Vec<RecordRelationshipItem>,
    pub incoming: Vec<RecordRelationshipItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRelationshipPayload {
    pub source_id: String,
    pub target_id: String,
    pub relation_type: String,
    pub description: Option<String>,
}
