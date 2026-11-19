import { FC, useState, useEffect, useCallback } from "react";
import { ExcerptCitation } from "./types.ts";
import * as readerApi from "./readerApi.ts";

interface RecordExcerptsSectionProps {
  recordId: string;
  onOpenExcerptInReader?: (attachmentId: string, pageNumber: number) => void;
  onShowNotice: (msg: string) => void;
}

export const RecordExcerptsSection: FC<RecordExcerptsSectionProps> = ({
  recordId,
  onOpenExcerptInReader,
  onShowNotice,
}) => {
  const [excerpts, setExcerpts] = useState<ExcerptCitation[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadExcerpts = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await readerApi.getRecordExcerpts(recordId);
      setExcerpts(list);
    } catch (err) {
      console.error("Failed to load record excerpts:", err);
    } finally {
      setIsLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    loadExcerpts();
  }, [loadExcerpts]);

  const handleUnlink = async (highlightId: string) => {
    try {
      await readerApi.unlinkHighlightFromRecord(highlightId, recordId);
      setExcerpts((prev) => prev.filter((e) => e.highlight_id !== highlightId));
      onShowNotice("Excerpt unlinked from this record");
    } catch (err: any) {
      console.error("Failed to unlink excerpt:", err);
      onShowNotice(`Failed to unlink: ${err?.message || err}`);
    }
  };

  if (!isLoading && excerpts.length === 0) {
    return null; // Keep desk clean when no excerpts linked
  }

  return (
    <div className="record-excerpts-section">
      <div className="record-excerpts-heading">
        <span className="record-excerpts-title">
          Connected Research Excerpts & Quotations ({excerpts.length})
        </span>
      </div>

      <div className="record-excerpts-list">
        {excerpts.map((item) => (
          <div key={item.highlight_id} className="record-excerpt-quote">
            {item.is_stale && (
              <div className="card-stale-notice" style={{ marginBottom: "6px" }}>
                Anchor from earlier document revision (checksum mismatch)
              </div>
            )}

            <div className="excerpt-quote-text">"{item.selected_text}"</div>

            <div className="excerpt-citation-line">
              <button
                className="excerpt-source-link"
                onClick={() => {
                  if (onOpenExcerptInReader) {
                    onOpenExcerptInReader(item.attachment_id, item.page_number);
                  }
                }}
                title="Open passage in Research Reader"
              >
                <span>
                  Source: <em>{item.document_title}</em>, p. {item.page_number}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </button>

              <button
                className="card-action-link danger"
                onClick={() => handleUnlink(item.highlight_id)}
                title="Unlink excerpt from record (preserves original document highlight)"
              >
                Unlink
              </button>
            </div>

            {item.commentary && (
              <div className="excerpt-commentary">
                <strong>Commentary:</strong> {item.commentary}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
