/**
 * Minimal contract implemented by an editing surface that must settle before
 * the application is allowed to close.
 */
export interface SaveParticipant {
  isDirty(): boolean;
  isSaving(): boolean;
  /** Resolves only after the pending save has succeeded (true) or failed (false). */
  flush(): Promise<boolean>;
}

export interface CloseFlushResult {
  canClose: boolean;
  errors: string[];
}

export interface CloseAttemptResult extends CloseFlushResult {
  closed: boolean;
  duplicate: boolean;
}

export interface CloseAttemptOptions {
  isClosing(): boolean;
  beginClosing(): void;
  cancelClosing(): void;
  close(): void | Promise<void>;
}

// Guards against a close request spinning forever while edits keep arriving.
const MAX_FLUSH_ROUNDS = 8;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "A required save failed before Dace could close";
}

/**
 * Tracks active save participants. The returned unregister function is bound to
 * one registration so an unmounted component can never remove a later one.
 */
export class SaveParticipantRegistry {
  private readonly participants = new Set<SaveParticipant>();

  register(participant: SaveParticipant): () => void {
    this.participants.add(participant);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.participants.delete(participant);
    };
  }

  get size(): number {
    return this.participants.size;
  }

  list(): SaveParticipant[] {
    return [...this.participants];
  }

  isDirty(): boolean {
    return this.list().some((participant) => participant.isDirty());
  }

  isSaving(): boolean {
    return this.list().some((participant) => participant.isSaving());
  }

  async flushAll(): Promise<CloseFlushResult> {
    const errors: string[] = [];

    // Snapshot the participants: a save triggered here may unmount a view, but
    // the work it captured must still be allowed to finish.
    for (const participant of this.list()) {
      let rounds = 0;
      try {
        while ((participant.isDirty() || participant.isSaving()) && rounds < MAX_FLUSH_ROUNDS) {
          const ok = await participant.flush();
          rounds += 1;
          if (!ok) {
            errors.push("A required save failed before Dace could close");
            break;
          }
        }
        if (rounds >= MAX_FLUSH_ROUNDS && (participant.isDirty() || participant.isSaving())) {
          errors.push("A required save did not settle before Dace could close");
        }
      } catch (err) {
        errors.push(errorMessage(err));
      }
    }

    return { canClose: errors.length === 0, errors };
  }
}

export async function flushParticipantsForClose(
  registry: SaveParticipantRegistry
): Promise<CloseFlushResult> {
  return registry.flushAll();
}

/**
 * Coordinates one close attempt. The closing flag is set before flushing so a
 * second close request arriving during an in-flight save is a no-op; it is
 * cleared only when a failed flush leaves the app open for a retry.
 */
export async function attemptClose(
  registry: SaveParticipantRegistry,
  options: CloseAttemptOptions
): Promise<CloseAttemptResult> {
  if (options.isClosing()) {
    return { canClose: false, errors: [], closed: false, duplicate: true };
  }

  options.beginClosing();
  const result = await flushParticipantsForClose(registry);
  if (result.canClose) {
    await options.close();
    return { ...result, closed: true, duplicate: false };
  }

  options.cancelClosing();
  return { ...result, closed: false, duplicate: false };
}
