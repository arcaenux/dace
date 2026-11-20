import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../focus/tauriWindow.ts";
import type {
  Annotation,
  CreateHighlightInput,
  ExcerptCitation,
  Highlight,
  HighlightRecordLink,
  HighlightType,
} from "./types.ts";
import type { KnowledgeRecord } from "../knowledge/types.ts";

// Fallback in-memory state for mock / browser testing
let fallbackHighlights: Highlight[] = [];
let fallbackRecordLinks: HighlightRecordLink[] = [];
let fallbackIdCounter = 0;

const fallbackId = (prefix: string) => `${prefix}-${Date.now()}-${++fallbackIdCounter}`;

export async function createHighlight(
  input: CreateHighlightInput
): Promise<Highlight> {
  if (isTauriEnvironment()) {
    return await invoke<Highlight>("create_highlight", { input });
  }

  const now = new Date().toISOString();
  const id = fallbackId("mock-hl");
  let ann: Annotation | null = null;
  if (input.annotation_content && input.annotation_content.trim()) {
    ann = {
      id: fallbackId("mock-ann"),
      highlight_id: id,
      content: input.annotation_content.trim(),
      created_at: now,
      updated_at: now,
    };
  }

  const newHl: Highlight = {
    id,
    attachment_id: input.attachment_id,
    doc_sha256: "fallback_sha256",
    page_number: input.page_number,
    selected_text: input.selected_text,
    anchor_data: input.anchor_data,
    highlight_type: input.highlight_type,
    color: input.color || null,
    created_at: now,
    updated_at: now,
    is_stale: false,
    annotation: ann,
    linked_record_count: 0,
  };

  fallbackHighlights.push(newHl);
  return newHl;
}

export async function getAttachmentHighlights(
  attachmentId: string
): Promise<Highlight[]> {
  if (isTauriEnvironment()) {
    return await invoke<Highlight[]>("get_attachment_highlights", {
      attachmentId,
    });
  }

  return fallbackHighlights.filter((h) => h.attachment_id === attachmentId);
}

export async function updateHighlightType(
  highlightId: string,
  highlightType: HighlightType,
  color?: string | null
): Promise<void> {
  if (isTauriEnvironment()) {
    await invoke<void>("update_highlight_type", {
      highlightId,
      highlightType,
      color: color || null,
    });
    return;
  }

  const hl = fallbackHighlights.find((h) => h.id === highlightId);
  if (hl) {
    hl.highlight_type = highlightType;
    hl.color = color || null;
    hl.updated_at = new Date().toISOString();
  }
}

export async function deleteHighlight(highlightId: string): Promise<void> {
  if (isTauriEnvironment()) {
    await invoke<void>("delete_highlight", { highlightId });
    return;
  }

  fallbackHighlights = fallbackHighlights.filter((h) => h.id !== highlightId);
  fallbackRecordLinks = fallbackRecordLinks.filter((l) => l.highlight_id !== highlightId);
}

export async function saveAnnotation(
  highlightId: string,
  content: string
): Promise<Annotation> {
  if (isTauriEnvironment()) {
    return await invoke<Annotation>("save_annotation", {
      input: { highlight_id: highlightId, content },
    });
  }

  const now = new Date().toISOString();
  const ann: Annotation = {
    id: `mock-ann-${Date.now()}`,
    highlight_id: highlightId,
    content,
    created_at: now,
    updated_at: now,
  };

  const hl = fallbackHighlights.find((h) => h.id === highlightId);
  if (hl) {
    hl.annotation = ann;
  }
  return ann;
}

export async function deleteAnnotation(highlightId: string): Promise<void> {
  if (isTauriEnvironment()) {
    await invoke<void>("delete_annotation", { highlightId });
    return;
  }

  const hl = fallbackHighlights.find((h) => h.id === highlightId);
  if (hl) {
    hl.annotation = null;
  }
}

export async function linkHighlightToRecord(
  highlightId: string,
  recordId: string,
  commentary?: string | null
): Promise<void> {
  if (isTauriEnvironment()) {
    await invoke<void>("link_highlight_to_record", {
      input: {
        highlight_id: highlightId,
        record_id: recordId,
        commentary: commentary || null,
      },
    });
    return;
  }

  fallbackRecordLinks.push({
    highlight_id: highlightId,
    record_id: recordId,
    record_title: "Mock Record",
    commentary: commentary || null,
    created_at: new Date().toISOString(),
  });
  const hl = fallbackHighlights.find((h) => h.id === highlightId);
  if (hl) {
    hl.linked_record_count += 1;
  }
}

export async function unlinkHighlightFromRecord(
  highlightId: string,
  recordId: string
): Promise<void> {
  if (isTauriEnvironment()) {
    await invoke<void>("unlink_highlight_from_record", {
      highlightId,
      recordId,
    });
    return;
  }

  fallbackRecordLinks = fallbackRecordLinks.filter(
    (l) => !(l.highlight_id === highlightId && l.record_id === recordId)
  );
  const hl = fallbackHighlights.find((h) => h.id === highlightId);
  if (hl && hl.linked_record_count > 0) {
    hl.linked_record_count -= 1;
  }
}

export async function getRecordExcerpts(
  recordId: string
): Promise<ExcerptCitation[]> {
  if (isTauriEnvironment()) {
    return await invoke<ExcerptCitation[]>("get_record_excerpts", { recordId });
  }

  return fallbackRecordLinks
    .filter((l) => l.record_id === recordId)
    .map((l) => {
      const hl = fallbackHighlights.find((h) => h.id === l.highlight_id);
      return {
        highlight_id: l.highlight_id,
        attachment_id: hl?.attachment_id || "att-1",
        document_title: hl ? `Document ${hl.attachment_id}` : "Research document",
        page_number: hl?.page_number || 1,
        selected_text: hl?.selected_text || "Quoted excerpt...",
        highlight_type: hl?.highlight_type || "insight",
        commentary: l.commentary || null,
        created_at: l.created_at,
        is_stale: false,
      };
    });
}

export async function getHighlightRecords(
  highlightId: string
): Promise<HighlightRecordLink[]> {
  if (isTauriEnvironment()) {
    return await invoke<HighlightRecordLink[]>("get_highlight_records", {
      highlightId,
    });
  }

  return fallbackRecordLinks.filter((l) => l.highlight_id === highlightId);
}

export async function createRecordFromExcerpt(
  highlightId: string,
  title: string,
  commentary?: string | null
): Promise<KnowledgeRecord> {
  if (isTauriEnvironment()) {
    return await invoke<KnowledgeRecord>("create_record_from_excerpt", {
      input: {
        highlight_id: highlightId,
        title,
        commentary: commentary || null,
      },
    });
  }

  const now = new Date().toISOString();
  const sourceHighlight = fallbackHighlights.find((h) => h.id === highlightId);
  const quote = sourceHighlight?.selected_text || "";
  const citation = sourceHighlight
    ? `> ${quote}\n\nSource: ${sourceHighlight.attachment_id}, p. ${sourceHighlight.page_number}`
    : "";
  const rec: KnowledgeRecord = {
    id: fallbackId("rec-from-ex"),
    title: title || "New Insight Note",
    content: [citation, commentary].filter(Boolean).join("\n\n"),
    created_at: now,
    updated_at: now,
    tags: ["research"],
  };

  fallbackRecordLinks.push({
    highlight_id: highlightId,
    record_id: rec.id,
    record_title: rec.title,
    commentary: commentary || null,
    created_at: now,
  });

  const hl = fallbackHighlights.find((h) => h.id === highlightId);
  if (hl) {
    hl.linked_record_count += 1;
  }

  return rec;
}
