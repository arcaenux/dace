export interface NoteSnapshot {
  recordId: string;
  title: string;
  content: string;
  tags: string[];
}

export const READER_NOTE_TAG_PREFIX = "reader-note:";

export function readerNoteTag(attachmentId: string): string {
  return `${READER_NOTE_TAG_PREFIX}${attachmentId}`;
}

export function withReaderNoteTag(tags: string[], attachmentId: string): string[] {
  const tag = readerNoteTag(attachmentId);
  const withoutInternal = tags.filter((value) => !value.startsWith(READER_NOTE_TAG_PREFIX));
  return [tag, ...withoutInternal];
}

export function visibleNoteTags(tags: string[]): string[] {
  return tags.filter((value) => !value.startsWith(READER_NOTE_TAG_PREFIX));
}

export function hasPendingChanges(version: number, savedVersion: number): boolean {
  return version > savedVersion;
}

export function canCommitSnapshot(
  currentRecordId: string | null,
  snapshotRecordId: string
): boolean {
  return currentRecordId === snapshotRecordId;
}

export function nextSavedVersion(savedVersion: number, snapshotVersion: number): number {
  return Math.max(savedVersion, snapshotVersion);
}

export function snapshotEquals(a: NoteSnapshot | null, b: NoteSnapshot | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.recordId === b.recordId &&
    a.title === b.title &&
    a.content === b.content &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, index) => tag === b.tags[index])
  );
}

export function snapshotFromTags(tags: string[] | undefined): string[] {
  return Array.isArray(tags) ? [...tags] : [];
}

/**
 * Tracks which note snapshot is persisted. Kept independent of React so the
 * autosave rules can be exercised directly in tests.
 */
export class NoteSaveTracker {
  private version = 0;
  private savedVersion = 0;

  reset(): void {
    this.version = 0;
    this.savedVersion = 0;
  }

  markDirty(): number {
    this.version += 1;
    return this.version;
  }

  markClean(): number {
    this.version += 1;
    this.savedVersion = this.version;
    return this.version;
  }

  get currentVersion(): number {
    return this.version;
  }

  get lastSavedVersion(): number {
    return this.savedVersion;
  }

  get hasPending(): boolean {
    return hasPendingChanges(this.version, this.savedVersion);
  }

  /** A save can only update state if the note it captured is still active. */
  commit(
    snapshotVersion: number,
    currentRecordId: string | null,
    snapshotRecordId: string
  ): boolean {
    if (!canCommitSnapshot(currentRecordId, snapshotRecordId)) return false;
    this.savedVersion = nextSavedVersion(this.savedVersion, snapshotVersion);
    return true;
  }
}
