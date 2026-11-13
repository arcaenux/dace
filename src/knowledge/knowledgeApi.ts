import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../focus/tauriWindow";
import {
  CreateRecordPayload,
  KnowledgeRecord,
  KnowledgeRecordSummary,
  TagItem,
  UpdateRecordPayload,
} from "./types";

// In-memory fallback storage for standard browser dev testing when Tauri IPC is unavailable
let fallbackRecords: KnowledgeRecord[] = [];

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
