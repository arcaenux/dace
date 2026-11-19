export type HighlightType = "important" | "question" | "insight" | "definition";

export interface HighlightAnchorData {
  startOffset?: number;
  endOffset?: number;
  prefix?: string;
  suffix?: string;
  rects?: { left: number; top: number; width: number; height: number }[];
}

export interface Annotation {
  id: string;
  highlight_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface Highlight {
  id: string;
  attachment_id: string;
  doc_sha256: string;
  page_number: number;
  selected_text: string;
  anchor_data: string; // JSON encoded HighlightAnchorData
  highlight_type: HighlightType;
  color?: string | null;
  created_at: string;
  updated_at: string;
  is_stale: boolean;
  annotation?: Annotation | null;
  linked_record_count: number;
}

export interface HighlightRecordLink {
  highlight_id: string;
  record_id: string;
  record_title: string;
  commentary?: string | null;
  created_at: string;
}

export interface ExcerptCitation {
  highlight_id: string;
  attachment_id: string;
  document_title: string;
  page_number: number;
  selected_text: string;
  highlight_type: HighlightType;
  commentary?: string | null;
  created_at: string;
  is_stale: boolean;
}

export interface CreateHighlightInput {
  attachment_id: string;
  page_number: number;
  selected_text: string;
  anchor_data: string;
  highlight_type: HighlightType;
  color?: string | null;
  annotation_content?: string | null;
}

export interface OutlineItem {
  title: string;
  pageNumber?: number;
  dest?: any;
  items?: OutlineItem[];
}
