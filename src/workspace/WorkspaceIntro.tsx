import { FC, useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpen, FileText, Focus, Network, Plus } from "lucide-react";
import * as knowledgeApi from "../knowledge/knowledgeApi";
import { KnowledgeRecordSummary } from "../knowledge/types";
import { stripMarkdownPreview } from "../knowledge/markdownFormat.ts";

interface WorkspaceIntroProps {
  onOpenCommands: () => void;
  onOpenShortcuts: () => void;
  onEnterFocus: () => void;
  onOpenKnowledgeDesk: () => void;
  onNewRecord?: () => void;
  onOpenReader: () => void;
  onOpenGraph: () => void;
  onOpenRecord: (id: string) => void;
  onExportBackup: () => void;
  onRestoreBackup: () => void;
}

const formatRelativeTime = (timestamp?: string): string => {
  if (!timestamp) return "Recently";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Recently";

  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/** Re-render on the minute boundary only; the clock never shows seconds. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: number | undefined;
    const align = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000) + 50);
    return () => {
      window.clearTimeout(align);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);
  return now;
}

export const WorkspaceIntro: FC<WorkspaceIntroProps> = ({
  onOpenCommands,
  onEnterFocus,
  onOpenKnowledgeDesk,
  onNewRecord,
  onOpenReader,
  onOpenGraph,
  onOpenRecord,
}) => {
  const [recent, setRecent] = useState<KnowledgeRecordSummary[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await knowledgeApi.listRecords(undefined, 6, 0);
        if (mounted) setRecent(list.slice(0, 6));
      } catch {
        if (mounted) setRecent([]);
      } finally {
        if (mounted) setHasLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const now = useMinuteClock();
  const hours = now.getHours();
  const greeting = hours < 5 ? "Working late" : hours < 12 ? "Good morning" : hours < 18 ? "Good afternoon" : "Good evening";

  const { clock, dayPeriod } = useMemo(() => {
    const parts = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).formatToParts(now);
    return {
      clock: parts
        .filter((part) => part.type !== "dayPeriod")
        .map((part) => part.value)
        .join("")
        .trim(),
      dayPeriod: parts.find((part) => part.type === "dayPeriod")?.value ?? "",
    };
  }, [now]);

  const weekday = now.toLocaleDateString([], { weekday: "long" });
  const longDate = now.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
  const startWriting = onNewRecord || onOpenKnowledgeDesk;

  const [latest, ...others] = recent;
  const spaces = [
    { id: "desk", title: "Desk", icon: BookOpen, action: onOpenKnowledgeDesk },
    { id: "reader", title: "Reader", icon: FileText, action: onOpenReader },
    { id: "graph", title: "Graph", icon: Network, action: onOpenGraph },
  ];

  return (
    <div className="home-workspace home-clean">
      <span className="sr-only">DACE — RESEARCH WORKSPACE</span>

      <div className="home-layout">
        {/* Left: the time, big and bold, with the date beneath it. */}
        <section className="home-clock" aria-label="Today">
          <span className="home-greeting">{greeting}</span>
          <time className="home-time" dateTime={now.toISOString()} aria-label={`${clock} ${dayPeriod}`.trim()}>
            {clock}
            {dayPeriod && <span className="home-ampm">{dayPeriod}</span>}
          </time>
          <p className="home-date">
            <span className="home-weekday">{weekday}</span>
            <span className="home-longdate">{longDate}</span>
          </p>

          <div className="home-quick">
            <button type="button" className="home-pill is-primary" onClick={startWriting}>
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
              New record
            </button>
            <button type="button" className="home-pill" onClick={onEnterFocus} title="Distraction-free Focus Space (F11)">
              <Focus size={14} strokeWidth={1.7} aria-hidden="true" />
              Focus
            </button>
            <button type="button" className="home-pill is-ghost" onClick={onOpenCommands} title="Command palette">
              Commands <kbd>Ctrl K</kbd>
            </button>
          </div>
        </section>

        {/* Right: one clean zone — continue, recent, spaces. */}
        <section className="home-zone" aria-label="Pick up where you left off">
          {latest ? (
            <button type="button" className="home-continue" onClick={() => onOpenRecord(latest.id)}>
              <span className="home-eyebrow">Continue writing</span>
              <span className="home-continue-title">{latest.title.trim() || "Untitled"}</span>
              {latest.preview && (
                <span className="home-continue-preview">{stripMarkdownPreview(latest.preview)}</span>
              )}
              <span className="home-continue-foot">
                <time className="home-record-time" dateTime={latest.updated_at}>
                  Edited {formatRelativeTime(latest.updated_at)}
                </time>
                <ArrowRight size={14} strokeWidth={1.7} aria-hidden="true" />
              </span>
            </button>
          ) : (
            hasLoaded && (
              <button type="button" className="home-continue is-empty" onClick={startWriting}>
                <span className="home-eyebrow">A blank page</span>
                <span className="home-continue-title">Start your first record</span>
                <span className="home-continue-preview">
                  Capture a thought, then connect it to sources in the reader.
                </span>
                <span className="home-continue-foot">
                  <span>Ctrl N</span>
                  <ArrowRight size={14} strokeWidth={1.7} aria-hidden="true" />
                </span>
              </button>
            )
          )}

          {others.length > 0 && (
            <div className="home-block">
              <div className="home-block-head">
                <span className="home-eyebrow">Recent</span>
                <button type="button" className="home-link" onClick={onOpenKnowledgeDesk}>
                  All records
                </button>
              </div>
              <ul className="home-recent">
                {others.slice(0, 4).map((rec) => (
                  <li key={rec.id}>
                    <button type="button" onClick={() => onOpenRecord(rec.id)}>
                      <span className="home-recent-title">{rec.title.trim() || "Untitled"}</span>
                      <time className="home-record-time" dateTime={rec.updated_at}>
                        {formatRelativeTime(rec.updated_at)}
                      </time>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <nav className="home-spaces" aria-label="Workspaces">
            {spaces.map(({ id, title, icon: Icon, action }) => (
              <button key={id} type="button" className="home-space" onClick={action}>
                <Icon size={15} strokeWidth={1.6} aria-hidden="true" />
                {title}
              </button>
            ))}
          </nav>
        </section>
      </div>
    </div>
  );
};
