import { FC, useRef, useState, KeyboardEvent } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ListTree,
  Network,
  PanelRight,
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

type DeskContextView = "context" | "outline" | "graph";

interface KnowledgeContextPanelProps {
  record: KnowledgeRecord;
  outline: DeskOutlineItem[];
  isFocusSpace: boolean;
  onNavigateToRecord: (targetId: string) => void;
  onShowNotice: (msg: string) => void;
  onOpenExcerptInReader?: (attachmentId: string, pageNumber: number) => void;
  onJumpToLine: (line: number) => void;
  onOpenFullGraph?: () => void;
}

const views: { id: DeskContextView; label: string; icon: typeof PanelRight }[] = [
  { id: "context", label: "Context", icon: PanelRight },
  { id: "outline", label: "Outline", icon: ListTree },
  { id: "graph", label: "Graph", icon: Network },
];

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
  onNavigateToRecord,
  onShowNotice,
  onOpenExcerptInReader,
  onJumpToLine,
  onOpenFullGraph,
}) => {
  const [view, setView] = useState<DeskContextView>("context");
  const [metadataExpanded, setMetadataExpanded] = useState(true);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (isFocusSpace) return null;

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const current = views.findIndex((item) => item.id === view);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = (current + delta + views.length) % views.length;
    setView(views[next].id);
    tabRefs.current[next]?.focus();
  };

  return (
    <aside className="desk-context-panel" aria-label="Record context">
      <div className="desk-context-tabs" role="tablist" aria-label="Record views" onKeyDown={handleTabKeyDown}>
        {views.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              className={`desk-context-tab ${view === item.id ? "active" : ""}`}
              aria-selected={view === item.id}
              tabIndex={view === item.id ? 0 : -1}
              onClick={() => setView(item.id)}
            >
              <Icon size={13} strokeWidth={1.6} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className={`desk-context-body ${view === "graph" ? "graph-active" : ""}`}>
        {view === "context" && (
          <>
            <section className="desk-context-section" aria-label="Connections">
              <RecordRelationshipsPanel
                recordId={record.id}
                recordTitle={record.title}
                onNavigateToRecord={onNavigateToRecord}
                onShowNotice={onShowNotice}
              />
            </section>

            <section className="desk-context-section" aria-label="Documents">
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
            </section>

            <section className="desk-context-section metadata-section" aria-label="Metadata">
              <button
                type="button"
                className="desk-section-toggle"
                aria-expanded={metadataExpanded}
                onClick={() => setMetadataExpanded((current) => !current)}
              >
                {metadataExpanded ? (
                  <ChevronDown size={13} strokeWidth={1.6} aria-hidden="true" />
                ) : (
                  <ChevronRight size={13} strokeWidth={1.6} aria-hidden="true" />
                )}
                <span>Metadata</span>
              </button>

              {metadataExpanded && (
                <div className="desk-meta-grid">
                  <span>Created</span>
                  <span>{formatMetadataDate(record.created_at)}</span>
                  <span>Updated</span>
                  <span>{formatMetadataDate(record.updated_at)}</span>
                  <span>Type</span>
                  <span>Record</span>
                </div>
              )}
            </section>
          </>
        )}

        {view === "outline" && (
          <section className="desk-outline" aria-label="Record outline">
            <p className="desk-outline-note">Built from Markdown headings in this record.</p>
            {outline.length === 0 ? (
              <p className="desk-empty-note">
                No Markdown headings yet. Add one with <code># Heading</code> to build a live outline.
              </p>
            ) : (
              <ol className="desk-outline-list">
                {outline.map((item, index) => (
                  <li key={`${item.line}-${index}`} style={{ paddingLeft: `${(item.level - 1) * 13}px` }}>
                    <button type="button" onClick={() => onJumpToLine(item.line)}>
                      <span className="outline-line">{String(item.line).padStart(2, "0")}</span>
                      <span className="outline-text">{item.text}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
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
    </aside>
  );
};
