import test from "node:test";
import assert from "node:assert/strict";
import { getViewerType, formatFileSize } from "../src/attachments/types.ts";
import * as api from "../src/attachments/attachmentsApi.ts";

test("1. getViewerType correctly classifies document MIME types and extensions", () => {
  // PDF
  assert.strictEqual(getViewerType("application/pdf", "quantum_physics.pdf"), "pdf");
  assert.strictEqual(getViewerType("application/octet-stream", "paper.PDF"), "pdf");

  // Markdown
  assert.strictEqual(getViewerType("text/markdown", "notes.md"), "markdown");
  assert.strictEqual(getViewerType("text/plain", "readme.markdown"), "markdown");

  // Plain Text
  assert.strictEqual(getViewerType("text/plain", "log.txt"), "text");
  assert.strictEqual(getViewerType("application/json", "config.json"), "text");
  assert.strictEqual(getViewerType("text/csv", "dataset.csv"), "text");

  // Image
  assert.strictEqual(getViewerType("image/png", "diagram.png"), "image");
  assert.strictEqual(getViewerType("image/jpeg", "galaxy.jpg"), "image");
  assert.strictEqual(getViewerType("image/webp", "constellation.webp"), "image");
  assert.strictEqual(getViewerType("image/svg+xml", "vector.svg"), "image");

  // Generic
  assert.strictEqual(getViewerType("application/zip", "archive.zip"), "generic");
  assert.strictEqual(
    getViewerType("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "thesis.docx"),
    "generic"
  );
});

test("2. formatFileSize formats byte values with appropriate units", () => {
  assert.strictEqual(formatFileSize(512), "512 B");
  assert.strictEqual(formatFileSize(1024), "1.0 KB");
  assert.strictEqual(formatFileSize(1024 * 1024 * 2.5), "2.5 MB");
  assert.strictEqual(formatFileSize(1024 * 1024 * 1024 * 3.75), "3.75 GB");
});

test("3. Ingestion lifecycle: import, associate, and retrieve attachments", async () => {
  // 1. Ingest simulated bytes
  const sampleBytes = new TextEncoder().encode("# Literary Research Excerpt\n\nNotes on ontology.");
  const importRes = await api.importAttachmentFromBytes("ontology.md", sampleBytes, "rec-42");

  assert.ok(importRes.attachment.id);
  assert.strictEqual(importRes.attachment.file_name, "ontology.md");
  assert.strictEqual(importRes.attachment.mime_type, "text/markdown");
  assert.strictEqual(importRes.attachment.file_size, sampleBytes.length);
  assert.strictEqual(importRes.associated_record_id, "rec-42");

  // 2. Query record attachments
  const recordList = await api.getRecordAttachments("rec-42");
  const found = recordList.find((a) => a.id === importRes.attachment.id);
  assert.ok(found, "Imported attachment must be present in record attachments list");
  assert.strictEqual(found?.file_name, "ontology.md");
});

test("4. Disassociating attachment removes link without deleting attachment", async () => {
  const sampleBytes = new TextEncoder().encode("%PDF-1.7 Simulated PDF bytes");
  const importRes = await api.importAttachmentFromBytes("standalone.pdf", sampleBytes, "rec-99");

  // Verify associated
  let list = await api.getRecordAttachments("rec-99");
  assert.strictEqual(list.some((a) => a.id === importRes.attachment.id), true);

  // Disassociate
  const ok = await api.disassociateAttachmentFromRecord("rec-99", importRes.attachment.id);
  assert.strictEqual(ok, true);

  // Verify no longer listed for rec-99
  list = await api.getRecordAttachments("rec-99");
  assert.strictEqual(list.some((a) => a.id === importRes.attachment.id), false);
});

test("5. Permanent deletion removes attachment from vault", async () => {
  const sampleBytes = new TextEncoder().encode("temporary data");
  const importRes = await api.importAttachmentFromBytes("temp.txt", sampleBytes);

  const deleted = await api.deleteAttachment(importRes.attachment.id);
  assert.strictEqual(deleted, true);
});
