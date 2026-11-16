import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../focus/tauriWindow.ts";
import type {
  AttachmentDetails,
  AttachmentSummary,
  ImportAttachmentResult,
} from "./types.ts";

// In-memory fallback storage for standard browser dev testing when Tauri IPC is unavailable
let fallbackAttachments: AttachmentDetails[] = [];

export async function pickAndImportAttachment(
  recordId?: string
): Promise<ImportAttachmentResult | null> {
  if (isTauriEnvironment()) {
    return await invoke<ImportAttachmentResult | null>("pick_and_import_attachment", {
      recordId: recordId || null,
    });
  }

  // Fallback for browser testing
  const now = new Date().toISOString();
  const id = `web-att-${Date.now()}`;
  const mockSummary: AttachmentSummary = {
    id,
    file_name: "sample_paper.pdf",
    mime_type: "application/pdf",
    file_size: 1024 * 1024 * 2.4, // 2.4 MB
    sha256_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    created_at: now,
    record_count: recordId ? 1 : 0,
    file_exists: true,
  };

  const details: AttachmentDetails = {
    ...mockSummary,
    storage_path: `e3/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.pdf`,
    updated_at: now,
    integrity_ok: true,
    associated_records: recordId ? [recordId] : [],
  };
  fallbackAttachments.unshift(details);

  return {
    attachment: mockSummary,
    is_duplicate: false,
    associated_record_id: recordId || null,
  };
}

export async function importAttachmentFromPath(
  sourcePath: string,
  recordId?: string
): Promise<ImportAttachmentResult> {
  if (isTauriEnvironment()) {
    return await invoke<ImportAttachmentResult>("import_attachment_from_path", {
      sourcePath,
      recordId: recordId || null,
    });
  }

  const res = await pickAndImportAttachment(recordId);
  return res!;
}

export async function importAttachmentFromBytes(
  fileName: string,
  data: Uint8Array,
  recordId?: string
): Promise<ImportAttachmentResult> {
  if (isTauriEnvironment()) {
    return await invoke<ImportAttachmentResult>("import_attachment_from_bytes", {
      fileName,
      data: Array.from(data),
      recordId: recordId || null,
    });
  }

  const now = new Date().toISOString();
  const id = `web-att-${Date.now()}`;
  const mockSummary: AttachmentSummary = {
    id,
    file_name: fileName,
    mime_type: fileName.endsWith(".md")
      ? "text/markdown"
      : fileName.endsWith(".png")
      ? "image/png"
      : "application/octet-stream",
    file_size: data.length,
    sha256_hash: "samplehash" + Date.now(),
    created_at: now,
    record_count: recordId ? 1 : 0,
    file_exists: true,
  };

  const details: AttachmentDetails = {
    ...mockSummary,
    storage_path: `ff/${mockSummary.sha256_hash}.${fileName.split(".").pop() || "bin"}`,
    updated_at: now,
    integrity_ok: true,
    associated_records: recordId ? [recordId] : [],
  };
  fallbackAttachments.unshift(details);

  return {
    attachment: mockSummary,
    is_duplicate: false,
    associated_record_id: recordId || null,
  };
}

export async function getRecordAttachments(recordId: string): Promise<AttachmentSummary[]> {
  if (isTauriEnvironment()) {
    return await invoke<AttachmentSummary[]>("get_record_attachments", { recordId });
  }

  return fallbackAttachments
    .filter((a) => a.associated_records.includes(recordId))
    .map((a) => ({
      id: a.id,
      file_name: a.file_name,
      mime_type: a.mime_type,
      file_size: a.file_size,
      sha256_hash: a.sha256_hash,
      created_at: a.created_at,
      record_count: a.associated_records.length,
      file_exists: a.file_exists,
    }));
}

export async function listAllAttachments(): Promise<AttachmentSummary[]> {
  if (isTauriEnvironment()) {
    return await invoke<AttachmentSummary[]>("list_all_attachments");
  }

  return fallbackAttachments.map((a) => ({
    id: a.id,
    file_name: a.file_name,
    mime_type: a.mime_type,
    file_size: a.file_size,
    sha256_hash: a.sha256_hash,
    created_at: a.created_at,
    record_count: a.associated_records.length,
    file_exists: a.file_exists,
  }));
}

export async function getAttachmentDetails(attachmentId: string): Promise<AttachmentDetails> {
  if (isTauriEnvironment()) {
    return await invoke<AttachmentDetails>("get_attachment_details", { attachmentId });
  }

  const found = fallbackAttachments.find((a) => a.id === attachmentId);
  if (!found) {
    throw new Error(`Attachment ${attachmentId} not found`);
  }
  return found;
}

export async function associateAttachmentWithRecord(
  recordId: string,
  attachmentId: string
): Promise<void> {
  if (isTauriEnvironment()) {
    return await invoke<void>("associate_attachment_with_record", { recordId, attachmentId });
  }

  const found = fallbackAttachments.find((a) => a.id === attachmentId);
  if (found && !found.associated_records.includes(recordId)) {
    found.associated_records.push(recordId);
  }
}

export async function disassociateAttachmentFromRecord(
  recordId: string,
  attachmentId: string
): Promise<boolean> {
  if (isTauriEnvironment()) {
    return await invoke<boolean>("disassociate_attachment_from_record", {
      recordId,
      attachmentId,
    });
  }

  const found = fallbackAttachments.find((a) => a.id === attachmentId);
  if (found) {
    found.associated_records = found.associated_records.filter((id) => id !== recordId);
    return true;
  }
  return false;
}

export async function deleteAttachment(attachmentId: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    return await invoke<boolean>("delete_attachment", { attachmentId });
  }

  fallbackAttachments = fallbackAttachments.filter((a) => a.id !== attachmentId);
  return true;
}

export async function readAttachmentText(attachmentId: string): Promise<string> {
  if (isTauriEnvironment()) {
    return await invoke<string>("read_attachment_text", { attachmentId });
  }

  return "# Sample Markdown Research Note\n\nThis is a fallback document reading surface in NOVA DOME.";
}

export async function readAttachmentDataUrl(attachmentId: string): Promise<string> {
  if (isTauriEnvironment()) {
    return await invoke<string>("read_attachment_data_url", { attachmentId });
  }

  return "";
}

export async function openAttachmentInSystem(attachmentId: string): Promise<void> {
  if (isTauriEnvironment()) {
    return await invoke<void>("open_attachment_in_system", { attachmentId });
  }

  console.log(`[openAttachmentInSystem] Fallback open in system for ${attachmentId}`);
}
