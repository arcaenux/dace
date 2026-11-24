import test from "node:test";
import assert from "node:assert/strict";
import {
  SaveParticipantRegistry,
  attemptClose,
  flushParticipantsForClose,
  type SaveParticipant,
} from "../src/core/saveRegistry.ts";

interface StubParticipant extends SaveParticipant {
  flushes: number;
  dirty: boolean;
  saving: boolean;
}

function stub(options: { dirty?: boolean; saving?: boolean; flush?: () => Promise<boolean> } = {}): StubParticipant {
  const participant: StubParticipant = {
    flushes: 0,
    dirty: options.dirty ?? false,
    saving: options.saving ?? false,
    isDirty: () => participant.dirty,
    isSaving: () => participant.saving,
    flush: async () => {
      participant.flushes += 1;
      if (options.flush) return options.flush();
      participant.dirty = false;
      participant.saving = false;
      return true;
    },
  };
  return participant;
}

test("registry registers and unregisters a participant without retaining an unmounted view", async () => {
  const registry = new SaveParticipantRegistry();
  const participant = stub({ dirty: true });
  const unregister = registry.register(participant);

  assert.equal(registry.size, 1);
  assert.deepEqual(registry.list(), [participant]);

  unregister();
  unregister(); // idempotent cleanup must not affect later registrations
  assert.equal(registry.size, 0);
  assert.deepEqual(registry.list(), []);

  const result = await flushParticipantsForClose(registry);
  assert.deepEqual(result, { canClose: true, errors: [] });
  assert.equal(participant.flushes, 0, "an unmounted participant must not be flushed on close");
});

test("registry supports multiple participants and flushes only dirty or saving ones", async () => {
  const registry = new SaveParticipantRegistry();
  const clean = stub();
  const desk = stub({ dirty: true });
  const reader = stub({ saving: true });
  registry.register(clean);
  registry.register(desk);
  registry.register(reader);

  assert.equal(registry.isDirty(), true);
  assert.equal(registry.isSaving(), true);

  const result = await flushParticipantsForClose(registry);

  assert.deepEqual(result, { canClose: true, errors: [] });
  assert.equal(clean.flushes, 0, "a clean participant should not be flushed");
  assert.equal(desk.flushes, 1);
  assert.equal(reader.flushes, 1);
});

test("close waits for a save that was already in progress", async () => {
  const registry = new SaveParticipantRegistry();
  let releaseSave: (() => void) | null = null;
  const inFlight = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const participant = stub({
    saving: true,
    flush: async () => {
      await inFlight;
      participant.saving = false;
      return true;
    },
  });
  registry.register(participant);

  let resolved = false;
  const closePromise = flushParticipantsForClose(registry).then((result) => {
    resolved = true;
    return result;
  });

  await Promise.resolve();
  assert.equal(resolved, false, "close must remain pending while a save is in flight");

  releaseSave?.();
  assert.deepEqual(await closePromise, { canClose: true, errors: [] });
  assert.equal(participant.flushes, 1);
});

test("close is blocked when a required save fails", async () => {
  const registry = new SaveParticipantRegistry();
  const good = stub({ dirty: true });
  const failing = stub({
    dirty: true,
    flush: async () => {
      failing.dirty = true;
      return false;
    },
  });
  registry.register(good);
  registry.register(failing);

  const result = await flushParticipantsForClose(registry);

  assert.equal(result.canClose, false);
  assert.deepEqual(result.errors, ["A required save failed before Dace could close"]);
  assert.equal(good.flushes, 1, "other participants must still be flushed after a failure");
  assert.equal(failing.dirty, true, "failed saves must preserve dirty state");
});

test("a throwing flush blocks close with a readable error", async () => {
  const registry = new SaveParticipantRegistry();
  registry.register(
    stub({
      dirty: true,
      flush: async () => {
        throw new Error("Database is locked");
      },
    })
  );

  const result = await flushParticipantsForClose(registry);
  assert.equal(result.canClose, false);
  assert.deepEqual(result.errors, ["Database is locked"]);
});

test("close does not hang when newer edits keep a participant dirty", async () => {
  const registry = new SaveParticipantRegistry();
  const participant = stub({ dirty: true, flush: async () => true });
  registry.register(participant);

  const result = await flushParticipantsForClose(registry);

  assert.equal(result.canClose, false);
  assert.deepEqual(result.errors, ["A required save did not settle before Dace could close"]);
  assert.equal(participant.flushes, 8);
});

test("close orchestration flushes successfully then closes exactly once", async () => {
  const registry = new SaveParticipantRegistry();
  const participant = stub({ dirty: true });
  registry.register(participant);

  let closing = false;
  let closeCalls = 0;
  const result = await attemptClose(registry, {
    isClosing: () => closing,
    beginClosing: () => {
      closing = true;
    },
    cancelClosing: () => {
      closing = false;
    },
    close: async () => {
      closeCalls += 1;
    },
  });

  assert.deepEqual(result, { canClose: true, errors: [], closed: true, duplicate: false });
  assert.equal(participant.flushes, 1);
  assert.equal(closeCalls, 1);
  assert.equal(closing, true);
});

test("close orchestration keeps the app open when a flush fails", async () => {
  const registry = new SaveParticipantRegistry();
  const participant = stub({
    dirty: true,
    flush: async () => {
      participant.dirty = true;
      return false;
    },
  });
  registry.register(participant);

  let closing = false;
  let closeCalls = 0;
  const result = await attemptClose(registry, {
    isClosing: () => closing,
    beginClosing: () => {
      closing = true;
    },
    cancelClosing: () => {
      closing = false;
    },
    close: async () => {
      closeCalls += 1;
    },
  });

  assert.deepEqual(result, {
    canClose: false,
    errors: ["A required save failed before Dace could close"],
    closed: false,
    duplicate: false,
  });
  assert.equal(closeCalls, 0, "a failed flush must not close the window");
  assert.equal(closing, false, "a failed flush must allow a later retry");
});

test("duplicate close requests during an in-flight flush close only once", async () => {
  const registry = new SaveParticipantRegistry();
  let releaseSave: (() => void) | null = null;
  const inFlight = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const participant = stub({
    dirty: true,
    flush: async () => {
      await inFlight;
      participant.dirty = false;
      return true;
    },
  });
  registry.register(participant);

  let closing = false;
  let closeCalls = 0;
  const options = {
    isClosing: () => closing,
    beginClosing: () => {
      closing = true;
    },
    cancelClosing: () => {
      closing = false;
    },
    close: async () => {
      closeCalls += 1;
    },
  };

  const first = attemptClose(registry, options);
  assert.equal(closing, true, "the close flag must be set before the first flush awaits");

  const duplicate = await attemptClose(registry, options);
  assert.deepEqual(duplicate, { canClose: false, errors: [], closed: false, duplicate: true });

  releaseSave?.();
  const result = await first;

  assert.deepEqual(result, { canClose: true, errors: [], closed: true, duplicate: false });
  assert.equal(closeCalls, 1, "duplicate close requests must not trigger a second explicit close");
  assert.equal(participant.flushes, 1);
});
