import { FC, useState, useEffect, useRef, KeyboardEvent, MouseEvent } from "react";
import { CommandItem } from "../core/types";
import { filterCommands } from "../core/commandRegistry";

interface CommandPaletteProps {
  commands: CommandItem[];
  isOpen: boolean;
  onClose: () => void;
}

export const CommandPalette: FC<CommandPaletteProps> = ({
  commands,
  isOpen,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredCommands = filterCommands(commands, query);

  // Focus input whenever palette is opened and reset query
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Keep selected index bounded
  useEffect(() => {
    if (selectedIndex >= filteredCommands.length) {
      setSelectedIndex(Math.max(0, filteredCommands.length - 1));
    }
  }, [filteredCommands.length, selectedIndex]);

  if (!isOpen) return null;

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev <= 0 ? Math.max(0, filteredCommands.length - 1) : prev - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = filteredCommands[selectedIndex];
      if (selected) {
        selected.execute();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  return (
    <div className="overlay-backdrop" onClick={handleBackdropClick} role="dialog" aria-modal="true" aria-label="Command Palette">
      <div className="command-palette" ref={containerRef}>
        <div className="command-input-wrapper">
          <svg className="command-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            ref={inputRef}
            className="command-input"
            type="text"
            placeholder="Search commands and actions..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="command-palette-kbd">ESC to dismiss</kbd>
        </div>

        <div className="command-results" role="listbox">
          {filteredCommands.length === 0 ? (
            <div className="command-empty">No matching commands found</div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  role="option"
                  aria-selected={isSelected}
                  className={`command-item ${isSelected ? "selected" : ""}`}
                  onClick={() => cmd.execute()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="command-item-main">
                    <div className="command-item-name">
                      <span>{cmd.name}</span>
                      {!cmd.available && (
                        <span className="command-badge unavailable" title={cmd.unavailabilityReason}>
                          Planned
                        </span>
                      )}
                    </div>
                    {cmd.description && (
                      <div className="command-item-desc">{cmd.description}</div>
                    )}
                  </div>
                  {cmd.shortcut && (
                    <div className="command-shortcut">{cmd.shortcut}</div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="command-palette-footer">
          <div className="footer-hints">
            <span className="footer-hint-item">
              <kbd>↑</kbd><kbd>↓</kbd> navigate
            </span>
            <span className="footer-hint-item">
              <kbd>↵</kbd> select
            </span>
            <span className="footer-hint-item">
              <kbd>esc</kbd> close
            </span>
          </div>
          <span>NOVA DOME</span>
        </div>
      </div>
    </div>
  );
};
