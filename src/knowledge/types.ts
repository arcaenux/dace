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
