import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../focus/tauriWindow.ts";
import type {
  CreateRecordPayload,
  CreateRelationshipPayload,
  GraphEdge,
  GraphNode,
  KnowledgeGraphData,
  KnowledgeRecord,
  KnowledgeRecordSummary,
  RecordRelationshipItem,
  RecordRelationshipsResponse,
  TagItem,
  UpdateRecordPayload,
} from "./types.ts";

// In-memory fallback storage for standard browser dev testing when Tauri IPC is unavailable
let fallbackRecords: KnowledgeRecord[] = [];
let fallbackRelationships: RecordRelationshipItem[] = [];

export async function createRecord(payload: CreateRecordPayload): Promise<KnowledgeRecord> {
  if (isTauriEnvironment()) {
    return await invoke<KnowledgeRecord>("create_record", { payload });
  }

  // Fallback implementation for browser-only preview
  const now = new Date().toISOString();
  const newRecord: KnowledgeRecord = {
    id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: payload.title.trim() || "Untitled Record",
    content: payload.content,
    created_at: now,
    updated_at: now,
    tags: payload.tags || [],
  };
  fallbackRecords.unshift(newRecord);
  return newRecord;
}

export async function getRecord(id: string): Promise<KnowledgeRecord | null> {
  if (isTauriEnvironment()) {
    return await invoke<KnowledgeRecord | null>("get_record", { id });
  }

  const found = fallbackRecords.find((r) => r.id === id);
  return found || null;
}

export async function listRecords(
  tag?: string,
  limit?: number,
  offset?: number
): Promise<KnowledgeRecordSummary[]> {
  if (isTauriEnvironment()) {
    return await invoke<KnowledgeRecordSummary[]>("list_records", {
      tag: tag || null,
      limit: limit || null,
      offset: offset || null,
    });
  }

  let list = fallbackRecords;
  if (tag) {
    list = list.filter((r) => r.tags.includes(tag.toLowerCase()));
  }

  return list.map((r) => ({
    id: r.id,
    title: r.title,
    preview: r.content.slice(0, 140),
    created_at: r.created_at,
    updated_at: r.updated_at,
    tags: r.tags,
  }));
}

export async function updateRecord(payload: UpdateRecordPayload): Promise<KnowledgeRecord> {
  if (isTauriEnvironment()) {
    return await invoke<KnowledgeRecord>("update_record", { payload });
  }

  const idx = fallbackRecords.findIndex((r) => r.id === payload.id);
  if (idx === -1) {
    throw new Error(`Record not found: ${payload.id}`);
  }

  const updated: KnowledgeRecord = {
    ...fallbackRecords[idx],
    title: payload.title.trim() || "Untitled Record",
    content: payload.content,
    updated_at: new Date().toISOString(),
    tags: payload.tags !== undefined ? payload.tags : fallbackRecords[idx].tags,
  };
  fallbackRecords[idx] = updated;
  return updated;
}

export async function deleteRecord(id: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    return await invoke<boolean>("delete_record", { id });
  }

  const lenBefore = fallbackRecords.length;
  fallbackRecords = fallbackRecords.filter((r) => r.id !== id);
  return fallbackRecords.length < lenBefore;
}

export async function searchRecords(query: string): Promise<KnowledgeRecordSummary[]> {
  if (isTauriEnvironment()) {
    return await invoke<KnowledgeRecordSummary[]>("search_records", { query });
  }

  const clean = query.toLowerCase().trim();
  if (!clean) return listRecords();

  const matched = fallbackRecords.filter(
    (r) => r.title.toLowerCase().includes(clean) || r.content.toLowerCase().includes(clean)
  );

  return matched.map((r) => ({
    id: r.id,
    title: r.title,
    preview: r.content.slice(0, 140),
    created_at: r.created_at,
    updated_at: r.updated_at,
    tags: r.tags,
  }));
}

export async function listTags(): Promise<TagItem[]> {
  if (isTauriEnvironment()) {
    return await invoke<TagItem[]>("list_tags");
  }

  const counts: Record<string, number> = {};
  for (const r of fallbackRecords) {
    for (const t of r.tags) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }

  return Object.entries(counts).map(([name, count]) => ({
    id: name,
    name,
    count,
  }));
}

export async function createRelationship(
  payload: CreateRelationshipPayload
): Promise<RecordRelationshipItem> {
  if (isTauriEnvironment()) {
    return await invoke<RecordRelationshipItem>("create_relationship", { payload });
  }

  // Browser fallback
  const source = fallbackRecords.find((r) => r.id === payload.source_id);
  const target = fallbackRecords.find((r) => r.id === payload.target_id);

  if (!source || !target) {
    throw new Error("Source or target record not found in fallback store");
  }

  if (payload.source_id === payload.target_id) {
    throw new Error("A record cannot be related to itself");
  }

  const existing = fallbackRelationships.find(
    (r) =>
      r.source_id === payload.source_id &&
      r.target_id === payload.target_id &&
      r.relation_type === payload.relation_type
  );
  if (existing) {
    throw new Error(`A '${payload.relation_type}' relationship already exists between these records`);
  }

  const now = new Date().toISOString();
  const newRel: RecordRelationshipItem = {
    id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    source_id: source.id,
    source_title: source.title,
    target_id: target.id,
    target_title: target.title,
    relation_type: payload.relation_type,
    description: payload.description || null,
    created_at: now,
    is_outgoing: true,
  };

  fallbackRelationships.unshift(newRel);
  return newRel;
}

export async function deleteRelationship(id: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    return await invoke<boolean>("delete_relationship", { id });
  }

  const before = fallbackRelationships.length;
  fallbackRelationships = fallbackRelationships.filter((r) => r.id !== id);
  return fallbackRelationships.length < before;
}

export async function getRecordRelationships(
  recordId: string
): Promise<RecordRelationshipsResponse> {
  if (isTauriEnvironment()) {
    return await invoke<RecordRelationshipsResponse>("get_record_relationships", {
      recordId,
    });
  }

  const outgoing = fallbackRelationships
    .filter((r) => r.source_id === recordId)
    .map((r) => {
      const target = fallbackRecords.find((rec) => rec.id === r.target_id);
      return {
        ...r,
        target_title: target?.title || r.target_title,
        is_outgoing: true,
      };
    });

  const incoming = fallbackRelationships
    .filter((r) => r.target_id === recordId)
    .map((r) => {
      const source = fallbackRecords.find((rec) => rec.id === r.source_id);
      return {
        ...r,
        source_title: source?.title || r.source_title,
        is_outgoing: false,
      };
    });

  return { outgoing, incoming };
}

export async function getKnowledgeGraph(): Promise<KnowledgeGraphData> {
  if (isTauriEnvironment()) {
    return await invoke<KnowledgeGraphData>("get_knowledge_graph");
  }

  // Fallback for browser preview
  const nodes: GraphNode[] = fallbackRecords.map((r) => {
    const connCount = fallbackRelationships.filter(
      (rel) => rel.source_id === r.id || rel.target_id === r.id
    ).length;
    return {
      id: r.id,
      title: r.title,
      preview: r.content.slice(0, 140),
      tags: r.tags,
      updated_at: r.updated_at,
      connection_count: connCount,
    };
  });

  const edges: GraphEdge[] = fallbackRelationships.map((rel) => ({
    id: rel.id,
    source: rel.source_id,
    target: rel.target_id,
    relation_type: rel.relation_type,
    description: rel.description,
    created_at: rel.created_at,
  }));

  return { nodes, edges };
}
