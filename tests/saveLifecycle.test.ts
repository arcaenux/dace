import test from "node:test";
import assert from "node:assert/strict";
import {
  SaveCoordinator,
  RecordSwitchCoordinator,
  CloseCoordinator,
} from "../src/knowledge/saveCoordinator.ts";
import type { SaveSnapshot } from "../src/knowledge/saveCoordinator.ts";

// Helper delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("1. Closing with no unsaved changes allows immediate shutdown", async () => {
  let saveCalls = 0;
  const initial: SaveSnapshot = {
    recordId: "rec-1",
    title: "Clean Record",
    content: "No edits pending.",
    tags: ["clean"],
  };

  const coordinator = new SaveCoordinator(initial, async () => {
    saveCalls += 1;
  });

  const closeCoord = new CloseCoordinator(coordinator);
  const result = await closeCoord.handleCloseRequest();

  assert.strictEqual(result.canClose, true);
  assert.strictEqual(closeCoord.closePrevented, false, "Close should not be prevented when clean");
  assert.strictEqual(closeCoord.isClosed, true);
  assert.strictEqual(saveCalls, 0, "No saves should be triggered on clean close");
  coordinator.destroy();
});

test("2. Closing with a pending autosave flushes changes before allowing close", async () => {
  let savedSnapshot: SaveSnapshot | null = null;
  const initial: SaveSnapshot = {
    recordId: "rec-2",
    title: "Initial Title",
    content: "Initial content",
    tags: [],
  };

  const coordinator = new SaveCoordinator(
    initial,
    async (snapshot) => {
      savedSnapshot = snapshot;
    },
    500
  );

  coordinator.edit({ title: "Updated Title Before Close" });
  assert.strictEqual(coordinator.isDirty(), true);
  assert.strictEqual(coordinator.saveStatus, "unsaved");

  const closeCoord = new CloseCoordinator(coordinator);
  const result = await closeCoord.handleCloseRequest();

  assert.strictEqual(result.canClose, true);
  assert.strictEqual(closeCoord.closePrevented, true, "Close must be prevented while flushing pending save");
  assert.strictEqual(closeCoord.isClosed, true);
  assert.strictEqual(coordinator.isDirty(), false);
  assert.strictEqual(coordinator.saveStatus, "saved");
  assert.ok(savedSnapshot);
  assert.strictEqual((savedSnapshot as SaveSnapshot).title, "Updated Title Before Close");
  coordinator.destroy();
});

test("3. Closing while a save is in progress awaits the in-flight save", async () => {
  let saveCompleted = false;
  const initial: SaveSnapshot = {
    recordId: "rec-3",
    title: "In-Flight Title",
    content: "Content",
    tags: [],
  };

  const coordinator = new SaveCoordinator(
    initial,
    async () => {
      await delay(100);
      saveCompleted = true;
    },
    500
  );

  // Trigger immediate save
  coordinator.edit({ content: "Slow write in progress" });
  const inFlightPromise = coordinator.performSave();
  assert.strictEqual(coordinator.isSaving(), true);

  const closeCoord = new CloseCoordinator(coordinator);
  const result = await closeCoord.handleCloseRequest();

  await inFlightPromise;
  assert.strictEqual(saveCompleted, true, "In-flight save must complete before close finishes");
  assert.strictEqual(result.canClose, true);
  assert.strictEqual(closeCoord.isClosed, true);
  coordinator.destroy();
});

test("4. Database failure during close keeps application open and shows error", async () => {
  const initial: SaveSnapshot = {
    recordId: "rec-4",
    title: "Failing Save",
    content: "Content",
    tags: [],
  };

  const coordinator = new SaveCoordinator(
    initial,
    async () => {
      throw new Error("Disk I/O error or SQLite database locked");
    },
    500
  );

  coordinator.edit({ title: "Unsaved Changes on Failure" });

  const closeCoord = new CloseCoordinator(coordinator);
  const result = await closeCoord.handleCloseRequest();

  assert.strictEqual(result.canClose, false, "Close must be blocked when save fails");
  assert.strictEqual(closeCoord.closePrevented, true);
  assert.strictEqual(closeCoord.errorModalShown, true, "Error modal must be triggered for user");
  assert.strictEqual(coordinator.isDirty(), true, "Dirty state must be preserved on failure");
  assert.strictEqual(coordinator.saveStatus, "error");
  assert.match(coordinator.errorMessage || "", /SQLite database locked/);
  coordinator.destroy();
});

test("5. Retrying after a failed save successfully persists without duplicating record", async () => {
  let attempt = 0;
  let persistedCount = 0;
  const initial: SaveSnapshot = {
    recordId: "rec-5",
    title: "Retry Record",
    content: "Important content",
    tags: ["retry"],
  };

  const coordinator = new SaveCoordinator(
    initial,
    async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("Transient lock failure");
      }
      persistedCount += 1;
    },
    500
  );

  coordinator.edit({ content: "Important content with retry" });

  // First save fails
  const firstTry = await coordinator.flushSave();
  assert.strictEqual(firstTry, false);
  assert.strictEqual(coordinator.saveStatus, "error");
  assert.strictEqual(coordinator.isDirty(), true);

  // Second save (retry) succeeds
  const retryResult = await coordinator.flushSave();
  assert.strictEqual(retryResult, true);
  assert.strictEqual(coordinator.saveStatus, "saved");
  assert.strictEqual(coordinator.isDirty(), false);
  assert.strictEqual(persistedCount, 1, "Record must persist exactly once with same ID");
  coordinator.destroy();
});

test("6. Switching records with pending changes flushes current record before switching", async () => {
  const savedRecords: Record<string, SaveSnapshot> = {};

  const recordA: SaveSnapshot = {
    recordId: "rec-A",
    title: "Record A",
    content: "Initial A",
    tags: [],
  };
  const recordB: SaveSnapshot = {
    recordId: "rec-B",
    title: "Record B",
    content: "Initial B",
    tags: [],
  };

  savedRecords["rec-A"] = { ...recordA };
  savedRecords["rec-B"] = { ...recordB };

  const coordinator = new SaveCoordinator(recordA, async (snapshot) => {
    savedRecords[snapshot.recordId] = { ...snapshot };
  });

  const switchCoord = new RecordSwitchCoordinator(
    "rec-A",
    coordinator,
    async (id) => savedRecords[id] || null
  );

  // User edits Record A
  coordinator.edit({ title: "Record A Edited" });
  assert.strictEqual(coordinator.isDirty(), true);

  // User selects Record B
  const switchSuccess = await switchCoord.requestSwitch("rec-B");

  assert.strictEqual(switchSuccess, true);
  assert.strictEqual(switchCoord.activeRecordId, "rec-B");
  assert.strictEqual(savedRecords["rec-A"].title, "Record A Edited", "Record A edits must be flushed to store");
  assert.strictEqual(coordinator.getSnapshot().recordId, "rec-B");
  assert.strictEqual(coordinator.isDirty(), false);
  coordinator.destroy();
});

test("7. Rapid successive edits debounce properly and save latest state", async () => {
  let saveCount = 0;
  let finalSavedTitle = "";

  const initial: SaveSnapshot = {
    recordId: "rec-7",
    title: "Rapid Typing",
    content: "Content",
    tags: [],
  };

  const coordinator = new SaveCoordinator(
    initial,
    async (snapshot) => {
      saveCount += 1;
      finalSavedTitle = snapshot.title;
    },
    80
  );

  // 10 rapid keystrokes within 50ms
  for (let i = 1; i <= 10; i++) {
    coordinator.edit({ title: `Typing letter ${i}` });
    await delay(5);
  }

  assert.strictEqual(saveCount, 0, "No saves should have fired during rapid typing");
  assert.strictEqual(coordinator.isDirty(), true);

  // Wait for debounce to settle
  await delay(120);

  assert.strictEqual(saveCount, 1, "Exactly one debounced save should fire after settling");
  assert.strictEqual(coordinator.isDirty(), false);
  assert.strictEqual(coordinator.saveStatus, "saved");
  assert.strictEqual(finalSavedTitle, "Typing letter 10");
  coordinator.destroy();
});

test("8. Editing while an earlier save is in progress queues follow-up and does not lose edits", async () => {
  const saveSnapshots: SaveSnapshot[] = [];

  const initial: SaveSnapshot = {
    recordId: "rec-8",
    title: "Initial Title",
    content: "Initial Content",
    tags: [],
  };

  const coordinator = new SaveCoordinator(
    initial,
    async (snapshot) => {
      await delay(80); // slow persistence
      saveSnapshots.push({ ...snapshot });
    },
    50
  );

  // User makes first edit
  coordinator.edit({ title: "First Edit" });
  const save1Promise = coordinator.performSave(); // in-flight

  // While save 1 is in-flight, user makes second edit
  await delay(20);
  coordinator.edit({ title: "Second Edit While In Flight" });

  await save1Promise;
  // After save 1 completes, coordinator detects newer mutations (either queuing or actively persisting)
  assert.ok(
    coordinator.saveStatus === "unsaved" || coordinator.saveStatus === "saving",
    `Expected unsaved or saving, got: ${coordinator.saveStatus}`
  );

  // Await the queued / follow-up save to complete cleanly
  await coordinator.flushSave();

  assert.strictEqual(coordinator.saveStatus, "saved");
  assert.strictEqual(coordinator.isDirty(), false);
  assert.strictEqual(saveSnapshots.length, 2);
  assert.strictEqual(saveSnapshots[0].title, "First Edit");
  assert.strictEqual(saveSnapshots[1].title, "Second Edit While In Flight");
  coordinator.destroy();
});

test("9. Multiple rapid record switches serialize safely without state overwrite", async () => {
  const recordsStore: Record<string, SaveSnapshot> = {
    "rec-1": { recordId: "rec-1", title: "Doc 1", content: "Content 1", tags: [] },
    "rec-2": { recordId: "rec-2", title: "Doc 2", content: "Content 2", tags: [] },
    "rec-3": { recordId: "rec-3", title: "Doc 3", content: "Content 3", tags: [] },
  };

  const coordinator = new SaveCoordinator(recordsStore["rec-1"], async (snapshot) => {
    await delay(30);
    recordsStore[snapshot.recordId] = { ...snapshot };
  });

  const switchCoord = new RecordSwitchCoordinator(
    "rec-1",
    coordinator,
    async (id) => recordsStore[id] || null
  );

  // User edits Doc 1
  coordinator.edit({ title: "Doc 1 Modified" });

  // User rapidly clicks Doc 2 then immediately Doc 3
  const switch1 = switchCoord.requestSwitch("rec-2");
  const switch2 = switchCoord.requestSwitch("rec-3");

  await Promise.all([switch1, switch2]);

  assert.strictEqual(switchCoord.activeRecordId, "rec-3", "Final active record must be the last clicked");
  assert.strictEqual(recordsStore["rec-1"].title, "Doc 1 Modified", "Doc 1 edits must be persisted");
  assert.strictEqual(coordinator.getSnapshot().recordId, "rec-3");
  assert.strictEqual(coordinator.isDirty(), false);
  coordinator.destroy();
});

test("10. Failed save during record switch aborts switch and preserves dirty state", async () => {
  const recordsStore: Record<string, SaveSnapshot> = {
    "rec-X": { recordId: "rec-X", title: "Doc X", content: "Important Unsaved Content", tags: [] },
    "rec-Y": { recordId: "rec-Y", title: "Doc Y", content: "Doc Y content", tags: [] },
  };

  const coordinator = new SaveCoordinator(recordsStore["rec-X"], async () => {
    throw new Error("Database lock failure");
  });

  const switchCoord = new RecordSwitchCoordinator(
    "rec-X",
    coordinator,
    async (id) => recordsStore[id] || null
  );

  coordinator.edit({ title: "Doc X Edited" });

  // Attempt to switch to Doc Y while Doc X fails to save
  const switchOk = await switchCoord.requestSwitch("rec-Y");

  assert.strictEqual(switchOk, false, "Switch must be rejected when active save fails");
  assert.strictEqual(switchCoord.activeRecordId, "rec-X", "Active record must remain Doc X to prevent data loss");
  assert.strictEqual(coordinator.isDirty(), true);
  assert.strictEqual(coordinator.saveStatus, "error");
  assert.strictEqual(coordinator.getSnapshot().title, "Doc X Edited");
  coordinator.destroy();
});
