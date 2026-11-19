import test from "node:test";
import assert from "node:assert/strict";
import * as readerApi from "../src/reader/readerApi.ts";
import type { HighlightType } from "../src/reader/types.ts";

test("1. Highlights lifecycle: create across restrained types, anchor, and retrieve", async () => {
  const types: HighlightType[] = ["important", "question", "insight", "definition"];

  for (const hlType of types) {
    const anchorData = JSON.stringify({
      startOffset: 100,
      endOffset: 160,
      prefix: "As shown in recent trials, ",
      suffix: ", demonstrating coherence.",
      rects: [{ left: 50, top: 120, width: 300, height: 18 }],
    });

    const highlight = await readerApi.createHighlight({
      attachment_id: "doc-test-42",
      page_number: 3,
      selected_text: `Sample passage highlighting category: ${hlType}`,
      anchor_data: anchorData,
      highlight_type: hlType,
      annotation_content: `Initial annotation for ${hlType}`,
    });

    assert.ok(highlight.id);
    assert.strictEqual(highlight.attachment_id, "doc-test-42");
    assert.strictEqual(highlight.page_number, 3);
    assert.strictEqual(highlight.highlight_type, hlType);
    assert.strictEqual(highlight.is_stale, false);
    assert.ok(highlight.annotation);
    assert.strictEqual(highlight.annotation?.content, `Initial annotation for ${hlType}`);
  }

  // Retrieve all highlights for document
  const list = await readerApi.getAttachmentHighlights("doc-test-42");
  assert.strictEqual(list.length, 4);
});

test("2. Annotations lifecycle: edit, update content, and delete", async () => {
  const highlight = await readerApi.createHighlight({
    attachment_id: "doc-test-ann",
    page_number: 1,
    selected_text: "Geodesic curves define free-fall trajectories.",
    anchor_data: JSON.stringify({ startOffset: 0, endOffset: 46 }),
    highlight_type: "definition",
  });

  // Initially null annotation
  assert.strictEqual(highlight.annotation, null);

  // 1. Save new annotation
  const savedAnn = await readerApi.saveAnnotation(
    highlight.id,
    "Fundamental principle of general relativity."
  );
  assert.strictEqual(savedAnn.content, "Fundamental principle of general relativity.");

  // Verify updated in list
  const list = await readerApi.getAttachmentHighlights("doc-test-ann");
  assert.strictEqual(list[0].annotation?.content, "Fundamental principle of general relativity.");

  // 2. Edit existing annotation
  const updatedAnn = await readerApi.saveAnnotation(
    highlight.id,
    "Revised note: compare with Newtonian inertial paths."
  );
  assert.strictEqual(updatedAnn.content, "Revised note: compare with Newtonian inertial paths.");

  // 3. Delete annotation
  await readerApi.deleteAnnotation(highlight.id);
  const listAfterDel = await readerApi.getAttachmentHighlights("doc-test-ann");
  assert.strictEqual(listAfterDel[0].annotation, null);
  assert.strictEqual(listAfterDel[0].selected_text, "Geodesic curves define free-fall trajectories.");
});

test("3. Knowledge Record integration: create record derived from excerpt", async () => {
  const highlight = await readerApi.createHighlight({
    attachment_id: "doc-newton-1",
    page_number: 14,
    selected_text: "Action and reaction are equal and opposite in direction.",
    anchor_data: JSON.stringify({ startOffset: 45, endOffset: 101 }),
    highlight_type: "important",
  });

  // Create derived record
  const newRecord = await readerApi.createRecordFromExcerpt(
    highlight.id,
    "Third Law of Motion & Symmetry",
    "Preserves conservation of momentum across closed interactions."
  );

  assert.ok(newRecord.id);
  assert.strictEqual(newRecord.title, "Third Law of Motion & Symmetry");
  assert.ok(newRecord.content.includes("conservation of momentum"));

  // Check link was formed
  const links = await readerApi.getHighlightRecords(highlight.id);
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].record_id, newRecord.id);

  // Check excerpts for record
  const citations = await readerApi.getRecordExcerpts(newRecord.id);
  assert.strictEqual(citations.length, 1);
  assert.strictEqual(citations[0].selected_text, "Action and reaction are equal and opposite in direction.");
  assert.strictEqual(citations[0].commentary, "Preserves conservation of momentum across closed interactions.");
});

test("4. Unlinking and deleting highlights preserves database referential integrity", async () => {
  const highlight = await readerApi.createHighlight({
    attachment_id: "doc-cleanup-1",
    page_number: 2,
    selected_text: "Entropy in isolated systems never decreases over time.",
    anchor_data: JSON.stringify({ startOffset: 10, endOffset: 65 }),
    highlight_type: "insight",
  });

  // Link to record
  await readerApi.linkHighlightToRecord(highlight.id, "rec-thermo-99", "Second Law commentary");
  let citations = await readerApi.getRecordExcerpts("rec-thermo-99");
  assert.strictEqual(citations.length, 1);

  // 1. Unlink excerpt from record
  await readerApi.unlinkHighlightFromRecord(highlight.id, "rec-thermo-99");
  citations = await readerApi.getRecordExcerpts("rec-thermo-99");
  assert.strictEqual(citations.length, 0);

  // Highlight should still exist for the document
  let docHls = await readerApi.getAttachmentHighlights("doc-cleanup-1");
  assert.strictEqual(docHls.length, 1);

  // 2. Delete highlight
  await readerApi.deleteHighlight(highlight.id);
  docHls = await readerApi.getAttachmentHighlights("doc-cleanup-1");
  assert.strictEqual(docHls.length, 0);
});
