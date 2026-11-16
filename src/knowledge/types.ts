export interface KnowledgeRecord {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  tags: string[];
}

export interface KnowledgeRecordSummary {
  id: string;
  title: string;
  preview: string;
  created_at: string;
  updated_at: string;
  tags: string[];
}

export interface CreateRecordPayload {
  title: string;
  content: string;
  tags?: string[];
}

export interface UpdateRecordPayload {
  id: string;
  title: string;
  content: string;
  tags?: string[];
}

export interface TagItem {
  id: string;
  name: string;
  count: number;
}

export type SaveStatus = "saved" | "saving" | "unsaved" | "error";

export type RelationType =
  | "related_to"
  | "builds_on"
  | "depends_on"
  | "explains"
  | "example_of"
  | "part_of"
  | "contrasts_with"
  | "applies_to";

export interface RecordRelationshipItem {
  id: string;
  source_id: string;
  source_title: string;
  target_id: string;
  target_title: string;
  relation_type: string;
  description: string | null;
  created_at: string;
  is_outgoing: boolean;
}

export interface RecordRelationshipsResponse {
  outgoing: RecordRelationshipItem[];
  incoming: RecordRelationshipItem[];
}

export interface CreateRelationshipPayload {
  source_id: string;
  target_id: string;
  relation_type: string;
  description?: string | null;
}

export interface GraphNode {
  id: string;
  title: string;
  preview: string;
  tags: string[];
  updated_at: string;
  connection_count: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation_type: string;
  description: string | null;
  created_at: string;
}

export interface KnowledgeGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
