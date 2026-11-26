import { FC } from "react";
import {
  ArrowUpRight,
  Info,
  Link2,
  ListTree,
  Network,
  Paperclip,
  X,
  type LucideIcon,
} from "lucide-react";
import { KnowledgeRecord } from "./types";
import { RecordRelationshipsPanel } from "./RecordRelationshipsPanel";
import { RecordAttachmentsPanel } from "../attachments/RecordAttachmentsPanel";
import { RecordExcerptsSection } from "../reader/RecordExcerptsSection";
import { KnowledgeGraphView } from "../graph/KnowledgeGraphView";

export interface DeskOutlineItem {
  level: number;
  text: string;
  line: number;
}

/** Derive a real outline from Markdown headings already present in the record. */
export function extractDeskOutline(content: string): DeskOutlineItem[] {
  const items: DeskOutlineItem[] = [];
  let inFence = false;

  content.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) return;

    const text = match[2].trim();
    if (!text) return;
    items.push({ level: match[1].length, text, line: index + 1 });
  });

  return items;
}

export type DeskPanelView = "connections" | "outline" | "documents" | "graph" | "info";

export const DESK_PANEL_VIEWS: { id: DeskPanelView; label: string; icon: LucideIcon }[] = [
  { id: "outline", label: "Outline", icon: ListTree },
  { id: "connections", label: "Connections", icon: Link2 },
  { id: "documents", label: "Documents", icon: Paperclip },
  { id: "graph", label: "Graph", icon: Network },
  { id: "info", label: "Info", icon: Info },
];

interface KnowledgeContextPanelProps {
  record: KnowledgeRecord;
  outline: DeskOutlineItem[];
  isFocusSpace: boolean;
  view: DeskPanelView | null;
  wordCount?: number;
  onNavigateToRecord: (targetId: string) => void;
  onShowNotice: (msg: string) => void;
  onOpenExcerptInReader?: (attachmentId: string, pageNumber: number) => void;
  onJumpToLine: (line: number) => void;
  onOpenFullGraph?: () => void;
  onClose?: () => void;
}

const formatMetadataDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

export const KnowledgeContextPanel: FC<KnowledgeContextPanelProps> = ({
  record,
  outline,
  isFocusSpace,
  view,
  wordCount,
  onNavigateToRecord,
  onShowNotice,
  onOpenExcerptInReader,
  onJumpToLine,
  onOpenFullGraph,
  onClose,
}) => {
  if (isFocusSpace) return null;
  const isOpen = view !== null;
  const meta = DESK_PANEL_VIEWS.find((item) => item.id === view);

  return (
    <aside
      className={`kd-panel ${isOpen ? "is-open" : ""}`}
      aria-label={meta ? meta.label : "Record context"}
      aria-hidden={!isOpen}
    >
      {isOpen && (
        <>
          <div className="kd-panel-head">
            <span className="kd-panel-title">{meta?.label}</span>
            {onClose && (
              <button
                type="button"
                className="kd-icon kd-icon-sm"
                onClick={onClose}
                aria-label="Close panel"
                title="Close panel"
              >
                <X size={13} strokeWidth={1.7} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className={`kd-panel-body ${view === "graph" ? "is-graph" : ""}`}>
            {view === "connections" && (
              <RecordRelationshipsPanel
                key={record.id}
                recordId={record.id}
                recordTitle={record.title}
                onNavigateToRecord={onNavigateToRecord}
                onShowNotice={onShowNotice}
              />
            )}

            {view === "documents" && (
              <>
                <RecordAttachmentsPanel
                  recordId={record.id}
                  onShowNotice={onShowNotice}
                  onOpenInReader={onOpenExcerptInReader}
                  compact
                />
                <RecordExcerptsSection
                  recordId={record.id}
                  onOpenExcerptInReader={onOpenExcerptInReader}
                  onShowNotice={onShowNotice}
                />
              </>
            )}

            {view === "info" && (
              <dl className="kd-info">
                <dt>Created</dt>
                <dd>{formatMetadataDate(record.created_at)}</dd>
                <dt>Updated</dt>
                <dd>{formatMetadataDate(record.updated_at)}</dd>
                {typeof wordCount === "number" && (
                  <>
                    <dt>Words</dt>
                    <dd data-count>{wordCount}</dd>
                  </>
                )}
                <dt>Tags</dt>
                <dd>{record.tags.length > 0 ? record.tags.map((tag) => `#${tag}`).join("  ") : "None"}</dd>
              </dl>
            )}

            {view === "outline" && (
              <nav className="kd-outline" aria-label="Record outline">
                {outline.length === 0 ? (
                  <p className="kd-panel-empty">
                    Headings appear here. Start a line with <code>#</code> or use the heading buttons.
                  </p>
                ) : (
                  <ol>
                    {outline.map((item, index) => (
                      <li key={`${item.line}-${index}`} data-level={Math.min(item.level, 4)}>
                        <button type="button" onClick={() => onJumpToLine(item.line)} title={item.text}>
                          {item.text}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </nav>
            )}

            {view === "graph" && (
              <div className="desk-graph-view">
                <KnowledgeGraphView
                  embedded
                  focusRecordId={record.id}
                  onOpenRecordInDesk={onNavigateToRecord}
                  onShowNotice={onShowNotice}
                />
                {onOpenFullGraph && (
                  <button type="button" className="desk-graph-open" onClick={onOpenFullGraph}>
                    Open full graph
                    <ArrowUpRight size={12} strokeWidth={1.6} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
};
