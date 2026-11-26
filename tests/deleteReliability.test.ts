import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as attachmentApi from "../src/attachments/attachmentsApi.ts";
import * as knowledgeApi from "../src/knowledge/knowledgeApi.ts";

test("1. Fallback delete APIs report false when nothing was removed", async () => {
  assert.strictEqual(await attachmentApi.deleteAttachment("missing-attachment-id"), false);
  assert.strictEqual(await knowledgeApi.deleteRecord("missing-record-id"), false);
  assert.strictEqual(await knowledgeApi.deleteRelationship("missing-relationship-id"), false);
});

test("2. Delete confirmations handle false, flush saves and clear stale targets", () => {
  const readSource = (relativePath: string) =>
    readFileSync(new URL(relativePath, import.meta.url), "utf8");

  const desk = readSource("../src/knowledge/KnowledgeDesk.tsx");
  for (const needle of [
    "if (!success)",
    "editorRef.current.flushSave()",
    "onRecordDeleted?.(deletedId)",
    "pendingSwitchTargetRef.current = null",
    "Deleting…",
  ]) {
    assert.ok(desk.includes(needle), `KnowledgeDesk is missing ${needle}`);
  }

  const shell = readSource("../src/workspace/WorkspaceShell.tsx");
  assert.ok(
    shell.includes("onRecordDeleted={(recordId)"),
    "WorkspaceShell is not clearing deleted record deep-links"
  );

  const editor = readSource("../src/knowledge/RecordEditor.tsx");
  assert.ok(editor.includes("mutationSeqRef.current <= lastSavedSeqRef.current"), "RecordEditor does not drain queued saves");
});

test("3. Relationship and attachment delete controls report every outcome", () => {
  const readSource = (relativePath: string) =>
    readFileSync(new URL(relativePath, import.meta.url), "utf8");

  const relationships = readSource("../src/knowledge/RecordRelationshipsPanel.tsx");
  assert.ok(relationships.includes("pendingDeleteId"), "Relationship delete has no in-flight guard");
  assert.ok(
    relationships.includes("Connection could not be removed"),
    "Relationship delete does not report a false result"
  );
  assert.ok(relationships.includes("await loadRelationships();"), "Relationship list is not refreshed after delete");

  const attachments = readSource("../src/attachments/RecordAttachmentsPanel.tsx");
  assert.ok(
    attachments.includes("Delete ${att.file_name} from storage"),
    "Attachment close button is not a delete confirmation"
  );
  assert.ok(attachments.includes("unlink-link"), "Attachment unlink action was removed");
  assert.ok(attachments.includes("if (!removed)"), "Attachment unlink ignores a false result");

  const api = readSource("../src/attachments/attachmentsApi.ts");
  assert.ok(api.includes("fallbackAttachments.length < before"), "Attachment fallback still reports false deletes as success");

  const rustCommand = readSource("../src-tauri/src/attachments/commands.rs");
  assert.ok(
    rustCommand.includes("storage.delete_file(&relative_path)?"),
    "Tauri attachment delete still hides physical delete failures"
  );
});

test("4. Reader note deletion removes every tagged duplicate and blocks racing saves", () => {
  const source = readFileSync(
    new URL("../src/reader/useReaderNote.ts", import.meta.url),
    "utf8"
  );
  for (const needle of [
    "deletingRef.current",
    "knowledgeApi.listRecords(tag)",
    "for (const id of ids)",
    "deletedIds.length < ids.size",
  ]) {
    assert.ok(source.includes(needle), `useReaderNote is missing ${needle}`);
  }
});

test("5. Physical attachment failure keeps the library row and refreshes the UI", () => {
  const readSource = (relativePath: string) =>
    readFileSync(new URL(relativePath, import.meta.url), "utf8");

  const command = readSource("../src-tauri/src/attachments/commands.rs");
  const targetAt = command.indexOf("AttachmentRepository::deletion_target");
  const rowDeleteAt = command.indexOf("AttachmentRepository::delete_attachment", targetAt + 1);
  assert.ok(targetAt >= 0, "Attachment delete must resolve the file before changing the database");
  assert.ok(rowDeleteAt > targetAt, "The library row must be deleted only after the file succeeds");

  const repository = readSource("../src-tauri/src/attachments/repository.rs");
  assert.ok(
    repository.includes("pub fn deletion_target"),
    "Repository is missing the pre-delete target lookup"
  );

  const panel = readSource("../src/attachments/RecordAttachmentsPanel.tsx");
  assert.ok(
    /catch \(err\) \{[\s\S]*?setDeleteConfirmId\(null\)[\s\S]*?await loadAttachments\(\)/.test(panel),
    "Attachment panel must reset confirmation and reload after a failed delete"
  );

  const reader = readSource("../src/reader/ResearchReaderView.tsx");
  assert.ok(
    /catch \(err: any\) \{[\s\S]*?await loadDocuments\(\)[\s\S]*?Delete failed/.test(reader),
    "Reader must reload documents after a failed attachment delete"
  );
});
