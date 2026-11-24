import { FC, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  FileText,
  Focus,
  Network,
  Plus,
  Search,
} from "lucide-react";
import * as knowledgeApi from "../knowledge/knowledgeApi";
import { KnowledgeRecordSummary } from "../knowledge/types";

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
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

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

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const list = await knowledgeApi.listRecords(undefined, 6, 0);
        if (mounted) setRecent(list.slice(0, 6));
      } catch {
        if (mounted) setRecent([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const hours = time.getHours();
  const greeting = hours < 12 ? "Good morning" : hours < 18 ? "Good afternoon" : "Good evening";
  const date = time.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });

  const workspaces = useMemo(
    () => [
      {
        id: "desk",
        title: "Knowledge Desk",
        desc: "Distraction-free record editor with tag taxonomy and link graphs",
        icon: BookOpen,
        action: onOpenKnowledgeDesk,
      },
      {
        id: "reader",
        title: "Research Reader",
        desc: "Adaptive PDF reader with precision excerpts and notes",
        icon: FileText,
        action: onOpenReader,
      },
      {
        id: "graph",
        title: "Knowledge Graph",
        desc: "Explore relationships and concept clusters in interactive space",
        icon: Network,
        action: onOpenGraph,
      },
    ],
    [onOpenGraph, onOpenKnowledgeDesk, onOpenReader]
  );

  return (
    <div className="home-workspace">
      <span className="sr-only">WELCOME TO DACE — A SPACE FOR DISCOVERY</span>

      <div className="home-container">
        {/* Header Section */}
        <header className="home-header">
          <div className="home-header-left">
            <span className="home-greeting-label">{date}</span>
            <h1 className="home-title">{greeting}</h1>
            <p className="home-tagline">Pick up a source or capture a new line of thought.</p>
          </div>

          <div className="home-header-actions">
            <button
              type="button"
              className="home-btn home-btn-primary"
              onClick={onNewRecord || onOpenKnowledgeDesk}
            >
              <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
              <span>New Record</span>
            </button>

            <button
              type="button"
              className="home-btn home-btn-subtle"
              onClick={onOpenCommands}
              title="Search and run commands (Ctrl+K)"
            >
              <Search size={14} strokeWidth={1.6} aria-hidden="true" />
              <span>Search</span>
              <kbd>Ctrl K</kbd>
            </button>

            <button
              type="button"
              className="home-btn home-btn-subtle"
              onClick={onEnterFocus}
              title="Enter distraction-free Focus Space (F11)"
            >
              <Focus size={14} strokeWidth={1.6} aria-hidden="true" />
              <span>Focus</span>
            </button>
          </div>
        </header>

        {/* Content Columns: Recent Work & Workspaces */}
        <div className="home-grid">
          {/* Recent Records Column */}
          <section className="home-section" aria-label="Recent Records">
            <div className="home-section-header">
              <h2 className="home-section-title">Recent Work</h2>
              {recent.length > 0 && (
                <button
                  type="button"
                  className="home-section-link"
                  onClick={onOpenKnowledgeDesk}
                >
                  <span>View all</span>
                  <ArrowUpRight size={12} aria-hidden="true" />
                </button>
              )}
            </div>

            {recent.length === 0 ? (
              <div className="home-empty-card">
                <FileText size={20} strokeWidth={1.5} className="home-empty-icon" />
                <p className="home-empty-text">No records yet. Start capturing your thoughts and research.</p>
                <button
                  type="button"
                  className="home-btn home-btn-primary"
                  onClick={onNewRecord || onOpenKnowledgeDesk}
                >
                  Create first record
                </button>
              </div>
            ) : (
              <div className="home-recent-list">
                {recent.map((rec, index) => (
                  <button
                    key={rec.id}
                    type="button"
                    className={`home-record-item ${index === 0 ? "is-continue" : ""}`}
                    onClick={() => onOpenRecord(rec.id)}
                  >
                    <div className="home-record-main">
                      <span className="home-record-title">
                        {rec.title.trim() ? rec.title : "Untitled Record"}
                      </span>
                      {rec.tags && rec.tags.length > 0 && (
                        <div className="home-record-tags">
                          {rec.tags.slice(0, 2).map((tag) => (
                            <span key={tag} className="home-record-tag">
                              #{tag}
                            </span>
                          ))}
                          {rec.tags.length > 2 && (
                            <span className="home-record-tag">+{rec.tags.length - 2}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="home-record-meta">
                      {index === 0 && <span className="home-continue-pill">Continue</span>}
                      <span className="home-record-time">{formatRelativeTime(rec.updated_at)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Workspaces Navigation Column */}
          <section className="home-section" aria-label="Workspaces">
            <div className="home-section-header">
              <h2 className="home-section-title">Workspaces</h2>
            </div>

            <div className="home-workspaces-list">
              {workspaces.map((ws) => {
                const Icon = ws.icon;
                return (
                  <button
                    key={ws.id}
                    type="button"
                    className="home-workspace-card"
                    onClick={ws.action}
                  >
                    <div className="home-ws-icon-box">
                      <Icon size={16} strokeWidth={1.6} aria-hidden="true" />
                    </div>
                    <div className="home-ws-info">
                      <div className="home-ws-title-row">
                        <span className="home-ws-title">{ws.title}</span>
                        <ArrowRight size={13} className="home-ws-arrow" aria-hidden="true" />
                      </div>
                      <p className="home-ws-desc">{ws.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
