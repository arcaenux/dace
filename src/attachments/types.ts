export interface AttachmentSummary {
  id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  sha256_hash: string;
  created_at: string;
  record_count: number;
  file_exists: boolean;
}

export interface AttachmentDetails {
  id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  sha256_hash: string;
  storage_path: string;
  created_at: string;
  updated_at: string;
  file_exists: boolean;
  integrity_ok: boolean;
  associated_records: string[];
}

export interface ImportAttachmentResult {
  attachment: AttachmentSummary;
  is_duplicate: boolean;
  associated_record_id?: string | null;
}

export type SupportedViewerType = "pdf" | "markdown" | "text" | "image" | "generic";

export function getViewerType(mimeType: string, fileName: string): SupportedViewerType {
  const lowerName = fileName.toLowerCase();
  if (mimeType === "application/pdf" || lowerName.endsWith(".pdf")) {
    return "pdf";
  }
  if (
    mimeType === "text/markdown" ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown")
  ) {
    return "markdown";
  }
  if (
    mimeType.startsWith("text/") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".json") ||
    lowerName.endsWith(".csv") ||
    lowerName.endsWith(".yaml") ||
    lowerName.endsWith(".yml") ||
    lowerName.endsWith(".toml")
  ) {
    return "text";
  }
  if (
    mimeType.startsWith("image/") ||
    lowerName.endsWith(".png") ||
    lowerName.endsWith(".jpg") ||
    lowerName.endsWith(".jpeg") ||
    lowerName.endsWith(".webp") ||
    lowerName.endsWith(".gif") ||
    lowerName.endsWith(".svg")
  ) {
    return "image";
  }
  return "generic";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
