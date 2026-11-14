export interface SaveSnapshot {
  recordId: string;
  title: string;
  content: string;
  tags: string[];
}

export type SaveHandler = (snapshot: SaveSnapshot) => Promise<void>;

/**
 * Manages autosave debouncing, strictly ordered mutation sequences,
 * and concurrency serialization for individual knowledge records.
 */
export class SaveCoordinator {
  public mutationSeq: number = 0;
  public lastSavedSeq: number = 0;
  public inFlightPromise: Promise<boolean> | null = null;
  public saveStatus: "saved" | "saving" | "unsaved" | "error" = "saved";
  public errorMessage: string | null = null;

  private activeSnapshot: SaveSnapshot;
  private onSave: SaveHandler;
  private debounceTimer: any = null;
  private debounceMs: number;

  constructor(initialSnapshot: SaveSnapshot, onSave: SaveHandler, debounceMs: number = 1000) {
    this.activeSnapshot = {
      recordId: initialSnapshot.recordId,
      title: initialSnapshot.title,
      content: initialSnapshot.content,
      tags: [...initialSnapshot.tags],
    };
    this.onSave = onSave;
    this.debounceMs = debounceMs;
  }

  public isDirty(): boolean {
    return this.mutationSeq > this.lastSavedSeq;
  }

  public isSaving(): boolean {
    return this.inFlightPromise !== null;
  }

  public getSnapshot(): SaveSnapshot {
    return {
      recordId: this.activeSnapshot.recordId,
      title: this.activeSnapshot.title,
      content: this.activeSnapshot.content,
      tags: [...this.activeSnapshot.tags],
    };
  }

  public edit(updates: Partial<Omit<SaveSnapshot, "recordId">>): void {
    if (updates.title !== undefined) this.activeSnapshot.title = updates.title;
    if (updates.content !== undefined) this.activeSnapshot.content = updates.content;
    if (updates.tags !== undefined) this.activeSnapshot.tags = [...updates.tags];

    this.mutationSeq += 1;
    this.saveStatus = "unsaved";
    this.errorMessage = null;

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.performSave();
    }, this.debounceMs);
  }

  public async performSave(): Promise<boolean> {
    // 1. If an active save is already in progress, await its completion first
    if (this.inFlightPromise) {
      try {
        await this.inFlightPromise;
      } catch {
        // Handled in that save's catch block
      }
      // If no new mutations were made while waiting for in-flight save:
      if (this.mutationSeq <= this.lastSavedSeq) {
        return this.saveStatus !== "error";
      }
    }

    // 2. Clear any pending debounce timer
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // 3. Check if there are unsaved mutations
    if (this.mutationSeq <= this.lastSavedSeq) {
      return true;
    }

    const targetSeq = this.mutationSeq;
    const snapshotToSave = this.getSnapshot();

    this.saveStatus = "saving";
    this.errorMessage = null;

    const execPromise = (async (): Promise<boolean> => {
      try {
        await this.onSave(snapshotToSave);

        // Update confirmed sequence if save succeeded
        if (targetSeq > this.lastSavedSeq) {
          this.lastSavedSeq = targetSeq;
        }

        // Did user edit WHILE this save was running?
        if (this.mutationSeq > targetSeq) {
          this.saveStatus = "unsaved";
          if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
          }
          this.debounceTimer = setTimeout(() => {
            this.performSave();
          }, this.debounceMs);
        } else {
          this.saveStatus = "saved";
        }
        return true;
      } catch (err: any) {
        this.saveStatus = "error";
        this.errorMessage = err?.message || "Failed to persist record to SQLite";
        return false;
      } finally {
        this.inFlightPromise = null;
      }
    })();

    this.inFlightPromise = execPromise;
    return await execPromise;
  }

  public async flushSave(): Promise<boolean> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    return await this.performSave();
  }

  public reset(newSnapshot: SaveSnapshot): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.activeSnapshot = {
      recordId: newSnapshot.recordId,
      title: newSnapshot.title,
      content: newSnapshot.content,
      tags: [...newSnapshot.tags],
    };
    this.mutationSeq = 0;
    this.lastSavedSeq = 0;
    this.inFlightPromise = null;
    this.saveStatus = "saved";
    this.errorMessage = null;
  }

  public destroy(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

/**
 * Coordinates safe record switching, ensuring pending changes are saved,
 * older responses do not overwrite newer state, and rapid switches serialize safely.
 */
export class RecordSwitchCoordinator {
  public activeRecordId: string;
  public isSwitching: boolean = false;
  private pendingTargetId: string | null = null;
  private saveCoordinator: SaveCoordinator;
  private fetchRecord: (id: string) => Promise<SaveSnapshot | null>;

  constructor(
    initialRecordId: string,
    saveCoordinator: SaveCoordinator,
    fetchRecord: (id: string) => Promise<SaveSnapshot | null>
  ) {
    this.activeRecordId = initialRecordId;
    this.saveCoordinator = saveCoordinator;
    this.fetchRecord = fetchRecord;
  }

  public async requestSwitch(targetId: string): Promise<boolean> {
    if (this.activeRecordId === targetId) return true;

    this.pendingTargetId = targetId;
    if (this.isSwitching) {
      return false;
    }

    this.isSwitching = true;
    try {
      while (this.pendingTargetId !== null) {
        const nextId = this.pendingTargetId;
        this.pendingTargetId = null;

        // 1. Flush active record if dirty
        if (this.saveCoordinator.isDirty() || this.saveCoordinator.isSaving()) {
          const saved = await this.saveCoordinator.flushSave();
          if (!saved) {
            // Save failed: preserve current record and abort switch
            this.pendingTargetId = null;
            return false;
          }
        }

        // 2. Fetch and load target record
        const nextRecord = await this.fetchRecord(nextId);
        if (nextRecord) {
          this.activeRecordId = nextRecord.recordId;
          this.saveCoordinator.reset(nextRecord);
        } else {
          return false;
        }
      }
      return true;
    } finally {
      this.isSwitching = false;
    }
  }
}

/**
 * Coordinates application shutdown, preventing window close while persistence is pending,
 * handling failures gracefully, and preventing infinite close loops.
 */
export class CloseCoordinator {
  public isClosed: boolean = false;
  public closePrevented: boolean = false;
  public errorModalShown: boolean = false;
  private saveCoordinator: SaveCoordinator;

  constructor(saveCoordinator: SaveCoordinator) {
    this.saveCoordinator = saveCoordinator;
  }

  public async handleCloseRequest(): Promise<{ canClose: boolean; error?: string }> {
    if (this.isClosed) {
      return { canClose: true };
    }

    const hasDirty = this.saveCoordinator.isDirty();
    const hasInFlight = this.saveCoordinator.isSaving();

    if (hasDirty || hasInFlight) {
      this.closePrevented = true;
      const ok = await this.saveCoordinator.flushSave();
      if (ok) {
        this.isClosed = true;
        return { canClose: true };
      } else {
        this.errorModalShown = true;
        return {
          canClose: false,
          error: this.saveCoordinator.errorMessage || "Database write error during shutdown",
        };
      }
    }

    this.isClosed = true;
    return { canClose: true };
  }
}
