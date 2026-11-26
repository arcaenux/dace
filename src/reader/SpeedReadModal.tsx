import {
  FC,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pause, Play, RotateCcw, SkipBack, SkipForward, X } from "lucide-react";
import { useDismissable } from "../core/useDismissable";
import {
  estimateSpeedMinutes,
  formatSpeedDuration,
  speedChunkIntervalMs,
  speedFocusSplit,
  speedWordCount,
  tokenizeSpeedText,
} from "./speedRead.ts";

interface SpeedReadModalProps {
  text: string;
  sourceLabel: string;
  onClose: () => void;
}

const MIN_WPM = 50;
const MAX_WPM = 1200;
const DEFAULT_WPM = 280;
const CHUNK_SIZES = [1, 2, 3, 4];

function readPreference(key: string, fallback: number): number {
  try {
    const stored = window.localStorage.getItem(`dace.speed-read.${key}`);
    const value = Number(stored);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export const SpeedReadModal: FC<SpeedReadModalProps> = ({
  text,
  sourceLabel,
  onClose,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [wpm, setWpm] = useState(() =>
    Math.max(MIN_WPM, Math.min(MAX_WPM, Math.round(readPreference("wpm", DEFAULT_WPM))))
  );
  const [chunkSize, setChunkSize] = useState(() =>
    Math.max(1, Math.min(4, Math.round(readPreference("chunk", 1))))
  );
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useDismissable(true, onClose, modalRef, {
    group: "reader-dialog",
    autoFocus: true,
    blocksShortcuts: true,
    outsideClickGraceMs: 200,
  });

  const chunks = useMemo(() => tokenizeSpeedText(text, chunkSize), [text, chunkSize]);
  const wordCount = useMemo(() => speedWordCount(text), [text]);

  useEffect(() => {
    try {
      window.localStorage.setItem("dace.speed-read.wpm", String(wpm));
      window.localStorage.setItem("dace.speed-read.chunk", String(chunkSize));
    } catch {
      // Preferences are a nicety; private browsing can reject localStorage.
    }
  }, [wpm, chunkSize]);

  useEffect(() => {
    setIndex(0);
    setIsPlaying(false);
  }, [text, chunkSize]);

  useEffect(() => {
    if (index >= chunks.length - 1 && isPlaying) setIsPlaying(false);
  }, [index, chunks.length, isPlaying]);

  useEffect(() => {
    if (!isPlaying || chunks.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => Math.min(current + 1, chunks.length - 1));
    }, speedChunkIntervalMs(wpm, chunkSize));
    return () => window.clearInterval(timer);
  }, [isPlaying, wpm, chunkSize, chunks.length]);

  const commitWpm = useCallback((value: number) => {
    const safe = Math.round(value);
    if (!Number.isFinite(safe)) return;
    setWpm(Math.max(MIN_WPM, Math.min(MAX_WPM, safe)));
  }, []);

  const jump = useCallback(
    (amount: number) => {
      setIndex((current) => Math.max(0, Math.min(chunks.length - 1, current + amount)));
    },
    [chunks.length]
  );

  const isFinished = chunks.length > 0 && index >= chunks.length - 1;

  const handlePlayPause = useCallback(() => {
    if (!chunks.length) return;
    if (!isPlaying && index >= chunks.length - 1) setIndex(0);
    setIsPlaying((current) => !current);
  }, [chunks.length, index, isPlaying]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      const focusables = Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }

    // Keep arrow keys and Space native while the user edits a field.
    if (event.target instanceof HTMLInputElement) return;

    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      handlePlayPause();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      jump(-10);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      jump(10);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      commitWpm(wpm + 20);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      commitWpm(wpm - 20);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setIndex(0);
      setIsPlaying(false);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setIndex(Math.max(0, chunks.length - 1));
      setIsPlaying(false);
    }
  };

  const current = chunks[Math.min(index, Math.max(0, chunks.length - 1))] ?? [];
  const focusIndex = Math.floor(current.length / 2);
  const progress = chunks.length > 1 ? (index / (chunks.length - 1)) * 100 : chunks.length ? 100 : 0;
  const remainingWords = Math.max(0, wordCount - index * chunkSize);
  const wordsRead = Math.min(wordCount, index * chunkSize + current.length);
  const hasText = chunks.length > 0;
  const statusText = !hasText
    ? "No readable text in this source."
    : isPlaying
      ? `Reading at ${wpm} words per minute.`
      : `Paused at chunk ${index + 1} of ${chunks.length}.`;

  return (
    <div className="overlay-backdrop speed-read-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className="speed-read-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="speed-read-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header className="speed-read-header">
          <div className="speed-read-heading">
            <span className="speed-read-overline">Research Reader</span>
            <h2 id="speed-read-title" className="speed-read-title">
              Speed Reader
            </h2>
            <p className="speed-read-source" title={sourceLabel}>
              {sourceLabel}
            </p>
          </div>
          <button
            className="speed-read-close"
            onClick={onClose}
            aria-label="Close speed reader"
            title="Close (Esc)"
            data-overlay-initial-focus={hasText ? undefined : "true"}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <section className="speed-read-stage" aria-label="Reading stage">
          {hasText ? (
            <>
              <div className="speed-read-stage-meta" aria-hidden="true">
                <span>{wpm} WPM</span>
                <span>{chunkSize === 1 ? "Single word" : `${chunkSize} words per chunk`}</span>
              </div>
              <div className="speed-read-word" key={index} aria-hidden="true">
                {current.map((word, wordIndex) => {
                  const isFocus = wordIndex === focusIndex;
                  const split = isFocus ? speedFocusSplit(word) : null;
                  return (
                    <span
                      key={`${index}-${wordIndex}`}
                      className={`speed-read-token${isFocus ? " focus" : ""}`}
                    >
                      {split ? (
                        <>
                          {split.before}
                          <span className="speed-read-orp">{split.focus}</span>
                          {split.after}
                        </>
                      ) : (
                        word
                      )}
                    </span>
                  );
                })}
              </div>
              <p className="speed-read-sr-status" aria-live="polite" aria-atomic="true">
                {statusText}
              </p>
              <div
                className="speed-read-progress"
                role="progressbar"
                aria-label="Reading progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
                aria-valuetext={`${Math.round(progress)} percent complete`}
              >
                <div className="speed-read-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <dl className="speed-read-readout">
                <div>
                  <dt>Position</dt>
                  <dd>
                    {index + 1} / {chunks.length}
                  </dd>
                </div>
                <div>
                  <dt>Read</dt>
                  <dd>
                    {wordsRead.toLocaleString()} / {wordCount.toLocaleString()} words
                  </dd>
                </div>
                <div>
                  <dt>Remaining</dt>
                  <dd>
                    {isFinished
                      ? "Finished"
                      : `~${formatSpeedDuration(estimateSpeedMinutes(remainingWords, wpm))}`}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <div className="speed-read-empty">
              <p>No readable text was found in this source.</p>
              <span>
                Select a passage, open a text or Markdown document, or save a highlight, then try
                again.
              </span>
            </div>
          )}
        </section>

        <div className="speed-read-controls">
          <div className="speed-read-transport" role="group" aria-label="Playback">
            <button
              className="speed-read-icon-btn"
              onClick={() => {
                setIndex(0);
                setIsPlaying(false);
              }}
              disabled={!hasText}
              title="Restart from the beginning (Home)"
              aria-label="Restart"
            >
              <RotateCcw size={16} aria-hidden="true" />
            </button>
            <button
              className="speed-read-icon-btn"
              onClick={() => jump(-10)}
              disabled={!hasText || index === 0}
              title="Back 10 chunks (Left arrow)"
              aria-label="Back 10 chunks"
            >
              <SkipBack size={16} aria-hidden="true" />
            </button>
            <button
              className="speed-read-play-btn"
              onClick={handlePlayPause}
              disabled={!hasText}
              title={isPlaying ? "Pause (Space)" : "Play (Space)"}
              aria-label={isPlaying ? "Pause" : "Play"}
              data-overlay-initial-focus={hasText ? "true" : undefined}
            >
              {isPlaying ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              <span>{isPlaying ? "Pause" : isFinished ? "Replay" : "Play"}</span>
            </button>
            <button
              className="speed-read-icon-btn"
              onClick={() => jump(10)}
              disabled={!hasText || isFinished}
              title="Forward 10 chunks (Right arrow)"
              aria-label="Forward 10 chunks"
            >
              <SkipForward size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="speed-read-settings">
            <div className="speed-read-setting speed-read-speed">
              <span id="speed-read-speed-label" className="speed-read-setting-label">
                Speed
              </span>
              <input
                className="speed-read-range"
                type="range"
                min={MIN_WPM}
                max={MAX_WPM}
                step={10}
                value={wpm}
                onChange={(event) => commitWpm(Number(event.target.value))}
                aria-labelledby="speed-read-speed-label"
                aria-valuetext={`${wpm} words per minute`}
              />
              <span className="speed-read-number-wrap">
                <input
                  className="speed-read-number"
                  type="number"
                  min={MIN_WPM}
                  max={MAX_WPM}
                  value={wpm}
                  onChange={(event) => commitWpm(Number(event.target.value))}
                  aria-label="Words per minute value"
                />
                <span className="speed-read-unit">WPM</span>
              </span>
            </div>
            {wpm > 500 && (
              <p className="speed-read-caution">Comprehension typically drops above 500 WPM.</p>
            )}
            <div className="speed-read-setting speed-read-chunk">
              <span className="speed-read-setting-label">Chunk</span>
              <div className="speed-read-segment" role="group" aria-label="Words per chunk">
                {CHUNK_SIZES.map((size) => (
                  <button
                    key={size}
                    className={chunkSize === size ? "active" : ""}
                    onClick={() => setChunkSize(size)}
                    aria-pressed={chunkSize === size}
                    title={`${size} word${size === 1 ? "" : "s"} per chunk`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <footer className="speed-read-footer">
          <div className="speed-read-hints" role="group" aria-label="Keyboard shortcuts">
            <span>
              <kbd>Space</kbd> play / pause
            </span>
            <span>
              <kbd>←</kbd>
              <kbd>→</kbd> skip 10
            </span>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> speed
            </span>
            <span>
              <kbd>Home</kbd>
              <kbd>End</kbd> navigate
            </span>
            <span>
              <kbd>Esc</kbd> close
            </span>
          </div>
          <span className="speed-read-note">First-pass skim; use normal reading for dense text.</span>
        </footer>
      </div>
    </div>
  );
};
