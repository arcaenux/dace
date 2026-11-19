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
  Plus,
  Search,
} from "lucide-react";
import * as knowledgeApi from "../knowledge/knowledgeApi";
import { KnowledgeRecordSummary } from "../knowledge/types";
import heroArtwork from "../assets/images/hero/hero-astronaut.webp";
import planetarySurface from "../assets/images/hero/planetary-surface.webp";
import ambientGlow from "../assets/images/backgrounds/atmospheric-glow.webp";
import starfield from "../assets/images/textures/starfield.webp";
import orbitRing from "../assets/decorative/orbit-ring.svg";
import orbitArc from "../assets/decorative/orbit-arc.svg";
import crosshair from "../assets/decorative/crosshair.svg";
import cornerBracket from "../assets/decorative/corner-bracket.svg";

interface WorkspaceIntroProps {
  onOpenCommands: () => void;
  onOpenShortcuts: () => void;
  onEnterFocus: () => void;
  onOpenKnowledgeDesk: () => void;
  onOpenReader: () => void;
  onOpenGraph: () => void;
  onOpenRecord: (id: string) => void;
  onExportBackup: () => void;
  onRestoreBackup: () => void;
}

const formatRecordDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "UNDATED";
  const today = new Date();
  const isToday =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return date
    .toLocaleDateString([], { month: "short", day: "2-digit", year: "2-digit" })
    .toUpperCase();
};

export const WorkspaceIntro: FC<WorkspaceIntroProps> = ({
  onOpenCommands,
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
        const list = await knowledgeApi.listRecords(undefined, 4, 0);
        if (mounted) setRecent(list.slice(0, 4));
      } catch {
        if (mounted) setRecent([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const greeting = "GOOD AFTERNOON, JOSEPH";
  const clock = "15:42";
  const date = "MON, NOV 16, 2026";

  const modes = useMemo(
    () => [
      { label: "Capture", action: onOpenKnowledgeDesk },
      { label: "Connect", action: onOpenGraph },
      { label: "Reason", action: onOpenReader },
      { label: "Create", action: onOpenCommands },
    ],
    [onOpenCommands, onOpenGraph, onOpenKnowledgeDesk, onOpenReader]
  );

  const spaces = useMemo(
    () => [
      {
        id: "desk",
        title: "Knowledge Desk",
        purpose: "Capture and shape ideas",
        icon: BookOpen,
        action: onOpenKnowledgeDesk,
        code: "01",
      },
      {
        id: "reader",
        title: "Research Reader",
        purpose: "Read, mark and connect",
        icon: FileText,
        action: onOpenReader,
        code: "02",
      },
      {
        id: "graph",
        title: "Knowledge Graph",
        purpose: "Explore relationships",
        icon: Network,
        action: onOpenGraph,
        code: "03",
      },
      {
        id: "command",
        title: "Command Deck",
        purpose: "Search and run actions",
        icon: Command,
        action: onOpenCommands,
        code: "04",
      },
    ],
    [onOpenCommands, onOpenGraph, onOpenKnowledgeDesk, onOpenReader]
  );

  return (
    <div className="cinema-home">
      <span className="sr-only">WELCOME TO DACE — A SPACE FOR DISCOVERY</span>

      <img className="home-planetary-edge" src={planetarySurface} alt="" aria-hidden="true" />

      <section className="cinema-hero" aria-label="Dace workspace hero">
        <div className="hero-art" aria-hidden="true">
          <img className="hero-art-stars" src={starfield} alt="" />
          <img className="hero-art-atmosphere" src={ambientGlow} alt="" />
          <img className="hero-art-image" src={heroArtwork} alt="" />
          <span className="hero-art-shade" />
          <span className="hero-art-orange" />
        </div>

        <div className="hero-decor" aria-hidden="true">
          <img className="hero-decor-ring" src={orbitRing} alt="" />
          <img className="hero-decor-arc" src={orbitArc} alt="" />
          <img className="hero-decor-crosshair" src={crosshair} alt="" />
          <img className="hero-decor-bracket" src={cornerBracket} alt="" />
          <span className="hero-decor-rule" />
          <span className="hero-decor-node" />
        </div>

        <div className="hero-copy">
          <p className="hero-greeting">{greeting}</p>
          <h1 className="hero-display">DACE</h1>

          <nav className="hero-modes" aria-label="Workspace entry points">
            {modes.map((mode) => (
              <button key={mode.label} type="button" onClick={mode.action}>
                {mode.label}
              </button>
            ))}
          </nav>

          <p className="hero-lede">
            Your space for ideas, research, learning
            <br />
            and creative work.
          </p>

          <button type="button" className="hero-new-record" onClick={onOpenKnowledgeDesk}>
            <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
            New Record
          </button>
        </div>

        <aside className="hero-context" aria-label="Workspace context">
          <div className="hero-clock">
            <span className="hero-clock-date">{date}</span>
            <span className="hero-clock-time">{clock}</span>
          </div>
          <button type="button" className="hero-focus" onClick={onEnterFocus}>
            <span className="hero-focus-label">
              <Focus size={13} strokeWidth={1.6} aria-hidden="true" />
              Focus
            </span>
            <kbd>60min</kbd>
            <span className="sr-only">Enter a distraction-free workspace</span>
          </button>
          <span className="hero-context-rule" aria-hidden="true" />
        </aside>
      </section>

      <section className="home-lower" aria-label="Recent work and spaces">
        <div className="home-continue">
          <header className="home-section-head">
            <div>
              <span className="home-section-index">01 / RECENT WORK</span>
              <h2>Continue</h2>
            </div>
            <button type="button" onClick={onOpenKnowledgeDesk}>
              Open all <ArrowUpRight size={12} aria-hidden="true" />
            </button>
          </header>

          {recent.length === 0 ? (
            <div className="home-empty">
              <FileText size={20} strokeWidth={1.4} aria-hidden="true" />
              <div>
                <strong>No records yet</strong>
                <p>Your most recent work will appear here.</p>
              </div>
              <button type="button" onClick={onOpenKnowledgeDesk}>
                Create a record <ArrowRight size={12} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="home-continue-list">
              {recent.map((record, index) => {
                const category = record.tags?.[0] || "Knowledge record";
                return (
                  <button
                    key={record.id}
                    type="button"
                    className="home-continue-row"
                    onClick={() => onOpenRecord(record.id)}
                    title={record.title || "Untitled record"}
                  >
                    <span className="home-row-index">0{index + 1}</span>
                    <span className="home-row-title">{record.title || "Untitled record"}</span>
                    <span className="home-row-date">
                      <Clock3 size={10} aria-hidden="true" />
                      {formatRecordDate(record.updated_at || record.created_at)}
                    </span>
                    <span className="home-row-category">{category}</span>
                    <ArrowUpRight className="home-row-arrow" size={12} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <span className="home-separator" aria-hidden="true" />

        <div className="home-spaces">
          <header className="home-section-head">
            <div>
              <span className="home-section-index">02 / DESTINATIONS</span>
              <h2>Pinned Spaces</h2>
            </div>
          </header>
          <div className="home-space-grid">
            {spaces.map((space) => {
              const Icon = space.icon;
              return (
                <button key={space.id} type="button" className="home-space-tile" onClick={space.action}>
                  <span className="home-space-code">{space.code}</span>
                  <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                  <span className="home-space-name">{space.title}</span>
                  <span className="home-space-purpose">{space.purpose}</span>
                  <ArrowUpRight className="home-space-arrow" size={12} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <button type="button" className="home-command" onClick={onOpenCommands} data-dismiss-ignore>
        <Search size={16} strokeWidth={1.6} aria-hidden="true" />
        <span>Search or run a command.</span>
        <span className="home-command-keys">
          <kbd>Ctrl</kbd>
          <kbd>K</kbd>
        </span>
      </button>

      <div className="home-coordinate" aria-hidden="true">
        <span>05.6037° N</span>
        <span>00.1870° W</span>
      </div>
    </div>
  );
};
