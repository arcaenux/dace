import { FC, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Clock3,
  Command,
  FileText,
  Focus,
  Network,
  Pin,
  Plus,
  Search,
} from "lucide-react";
import * as knowledgeApi from "../knowledge/knowledgeApi";
import { KnowledgeRecordSummary } from "../knowledge/types";
import heroArtwork from "../assets/images/hero/hero-astronaut.webp";
import starfield from "../assets/images/textures/starfield.webp";
import ambientGlow from "../assets/images/backgrounds/atmospheric-glow.webp";
import orbitRing from "../assets/decorative/orbit-ring.svg";
import cornerBracket from "../assets/decorative/corner-bracket.svg";

interface WorkspaceIntroProps {
  onOpenCommands: () => void;
  onOpenShortcuts: () => void;
  onEnterFocus: () => void;
  onOpenKnowledgeDesk: () => void;
  onOpenReader: () => void;
  onOpenGraph: () => void;
  onOpenRecord: (id: string) => void;
}

export const WorkspaceIntro: FC<WorkspaceIntroProps> = ({
  onOpenCommands,
  onOpenShortcuts,
  onEnterFocus,
  onOpenKnowledgeDesk,
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

  const primaryActions = useMemo(
    () => [
      {
        id: "knowledge-desk",
        title: "Knowledge Desk",
        desc: "Capture and structure concepts, notes, and research records.",
        action: onOpenKnowledgeDesk,
        icon: BookOpen,
        code: "01",
      },
      {
        id: "reader",
        title: "Research Reader",
        desc: "Read documents, mark excerpts, and connect evidence to ideas.",
        action: onOpenReader,
        icon: FileText,
        code: "02",
      },
      {
        id: "graph",
        title: "Knowledge Graph",
        desc: "Explore relationships across your connected research.",
        action: onOpenGraph,
        icon: Network,
        code: "03",
      },
      {
        id: "commands",
        title: "Command Deck",
        desc: "Search, switch modes, and run actions from one place.",
        action: onOpenCommands,
        icon: Command,
        code: "04",
      },
    ],
    [onOpenCommands, onOpenGraph, onOpenKnowledgeDesk, onOpenReader]
  );

  return (
    <div className="cinematic-home">
      <section className="cinematic-hero" aria-label="Dace workspace hero">
        <img className="hero-artwork" src={heroArtwork} alt="" aria-hidden="true" />
        <img className="hero-starfield" src={starfield} alt="" aria-hidden="true" />
        <img className="hero-ambient" src={ambientGlow} alt="" aria-hidden="true" />
        <span className="hero-vignette" aria-hidden="true" />

        <div className="hero-content">
          <div className="hero-overline">
            <span className="hero-signal" aria-hidden="true" />
            <span>A SPACE FOR DISCOVERY</span>
            <span className="hero-overline-divider" aria-hidden="true" />
            <span className="hero-index-code">WELCOME TO DACE / WORKSPACE_01</span>
          </div>

          <h1 className="hero-display">Dace</h1>
          <p className="hero-descriptor">A space for discovery.</p>
          <p className="hero-lede">
            A quiet environment for deep work — where reading, notes, and relationships
            settle into one living system.
          </p>

          <div className="hero-actions">
            <button type="button" className="dace-btn dace-btn-primary" onClick={onOpenKnowledgeDesk}>
              <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
              New Record
            </button>
            <button type="button" className="dace-btn dace-btn-ghost" onClick={onOpenCommands}>
              <Search size={16} strokeWidth={1.8} aria-hidden="true" />
              Search workspace
            </button>
          </div>

          <div className="hero-shortcuts">
            <button type="button" onClick={onOpenCommands}>
              <kbd>Ctrl K</kbd> Command
            </button>
            <button type="button" onClick={onOpenShortcuts}>
              <kbd>Ctrl Shift P</kbd> Shortcuts
            </button>
            <button type="button" onClick={onEnterFocus}>
              <kbd>F11</kbd> Focus
            </button>
          </div>
        </div>

        <img className="hero-orbit" src={orbitRing} alt="" aria-hidden="true" />
        <img className="hero-corner" src={cornerBracket} alt="" aria-hidden="true" />
        <div className="hero-coordinate" aria-hidden="true">
          <span>51° 28′ 40″ N</span>
          <span>OBSERVATORY / 001</span>
        </div>
      </section>

      <section className="cinematic-section" aria-label="Primary actions">
        <header className="section-head">
          <div>
            <span className="section-overline">01 / ENTRY POINTS</span>
            <h2 className="section-title">Begin where you left off</h2>
          </div>
          <span className="section-aside">SELECT A MODULE</span>
        </header>
        <div className="entry-grid">
          {primaryActions.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" className="entry-card" onClick={item.action}>
                <span className="entry-code">{item.code}</span>
                <span className="entry-icon"><Icon size={18} strokeWidth={1.6} aria-hidden="true" /></span>
                <span className="entry-title">{item.title}</span>
                <span className="entry-desc">{item.desc}</span>
                <span className="entry-cta">Open <ArrowRight size={14} aria-hidden="true" /></span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="cinematic-section" aria-label="Recent work">
        <header className="section-head">
          <div>
            <span className="section-overline">02 / CONTINUE</span>
            <h2 className="section-title">Recent records</h2>
          </div>
          <button type="button" className="section-action" onClick={onOpenKnowledgeDesk}>
            Knowledge Desk <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        </header>

        {recent.length === 0 ? (
          <div className="dace-empty-state">
            <FileText size={24} strokeWidth={1.4} aria-hidden="true" />
            <h3>No records yet</h3>
            <p>Start in the Knowledge Desk to create your first concept, note, or research record.</p>
            <button type="button" className="dace-btn dace-btn-primary" onClick={onOpenKnowledgeDesk}>
              <Plus size={15} aria-hidden="true" /> Create first record
            </button>
          </div>
        ) : (
          <div className="continue-grid">
            {recent.map((record, index) => (
              <button
                key={record.id}
                type="button"
                className="continue-card"
                onClick={() => onOpenRecord(record.id)}
              >
                <span className="continue-top">
                  <span className="continue-index">{String(index + 1).padStart(2, "0")}</span>
                  <Clock3 size={13} aria-hidden="true" />
                  <span className="continue-date">
                    {new Date(record.updated_at || record.created_at).toLocaleDateString()}
                  </span>
                </span>
                <span className="continue-title">{record.title || "Untitled Record"}</span>
                <span className="continue-preview">{record.preview || "No preview available."}</span>
                {record.tags?.length ? (
                  <span className="continue-tags">
                    {record.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="dace-badge">#{tag}</span>
                    ))}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="cinematic-context" aria-label="Workspace context">
        <article className="context-card">
          <header>
            <Pin size={15} aria-hidden="true" />
            <span className="section-overline">PINNED SPACES</span>
          </header>
          <p>Your working modules stay one gesture away.</p>
          <div className="context-links">
            <button type="button" onClick={onOpenKnowledgeDesk}><BookOpen size={15} /> Knowledge Desk</button>
            <button type="button" onClick={onOpenReader}><FileText size={15} /> Research Reader</button>
            <button type="button" onClick={onOpenGraph}><Network size={15} /> Knowledge Graph</button>
          </div>
        </article>

        <article className="context-card focus-card">
          <header>
            <Focus size={15} aria-hidden="true" />
            <span className="section-overline">FOCUS SPACE</span>
          </header>
          <p>Step into a distraction-free view while Dace keeps your place.</p>
          <button type="button" className="dace-btn dace-btn-ghost" onClick={onEnterFocus}>
            Enter Focus <kbd>F11</kbd>
          </button>
          <span className="focus-orbit" aria-hidden="true" />
        </article>
      </section>
    </div>
  );
};
