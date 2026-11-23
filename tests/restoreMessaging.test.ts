import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveFileName,
  inspectionProgressMessage,
  inspectionSuccessMessage,
  restoreOutcomeNotice,
  restoreStagedMessage,
} from "../src/backup/restoreMessages.ts";
import type { RestoreOutcome } from "../src/backup/restoreApi.ts";

test("inspection progress names the archive and reports the active stage", () => {
  assert.equal(
    inspectionProgressMessage({
      stage: "fingerprint",
      current: 0,
      total: 1,
      message: "Copying and fingerprinting research.ndarchive…",
    }),
    "Copying and fingerprinting research.ndarchive…"
  );
  assert.equal(inspectionProgressMessage(null), "Inspecting backup archive…");
});

test("inspection success states that integrity checks passed", () => {
  assert.equal(
    inspectionSuccessMessage("C:\\Backups\\research.ndarchive"),
    "Integrity checks passed for research.ndarchive. Review the restore summary."
  );
  assert.equal(archiveFileName("/tmp/old.backup"), "old.backup");
});

test("staged restore message requests rather than promises a restart", () => {
  const message = restoreStagedMessage(true);
  assert.match(message, /request a restart/);
  assert.match(message, /if it does not reopen automatically/);

  assert.equal(restoreStagedMessage(false), "Restore staged.");
});

test("startup outcome notices distinguish verified success from failure", () => {
  const success: RestoreOutcome = {
    success: true,
    message: "Restore completed and verified at startup.",
    archive_path: "/tmp/backup.ndarchive",
    record_count: 12,
    attachment_count: 3,
    recovery_dir: "/tmp/recovery",
    completed_at: "2026-11-23T00:00:00Z",
  };
  const failure: RestoreOutcome = {
    ...success,
    success: false,
    message: "CRITICAL: verification failed.",
  };

  assert.equal(
    restoreOutcomeNotice(success),
    "Restore complete — 12 records and 3 attachments verified."
  );
  assert.equal(restoreOutcomeNotice(failure), "Restore failed: CRITICAL: verification failed.");
});
