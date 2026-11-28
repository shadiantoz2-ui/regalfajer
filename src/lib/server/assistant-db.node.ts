import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import {
  deriveConversationTitle,
  deriveLastMessagePreview,
  extractMessageText,
  normalizeStoredMessageRows,
  truncateArabicText,
  validateAssistantNoteInput,
} from "../assistant-helpers";

test("extractMessageText joins non-empty text parts cleanly", () => {
  const parts = [
    { type: "tool-overview", toolCallId: "t1", state: "output-available", input: {}, output: {} },
    { type: "text", text: "  عدد الطلاب المسجلين 164 طالباً.  " },
    { type: "text", text: "أعلى حضور كان في يوم الجمعة." },
  ];
  assert.equal(
    extractMessageText(parts),
    "عدد الطلاب المسجلين 164 طالباً.\nأعلى حضور كان في يوم الجمعة.",
  );
});

test("deriveConversationTitle uses first user prompt and truncates long text", () => {
  const messages: UIMessage[] = [
    {
      id: "m1",
      role: "user",
      parts: [{ type: "text", text: "من هم أكثر 10 طلاب حضوراً لصلاة الفجر خلال الأسبوع الماضي في مسجد الغفران؟" }],
    },
    {
      id: "m2",
      role: "assistant",
      parts: [{ type: "text", text: "إليك القائمة..." }],
    },
  ];
  const title = deriveConversationTitle(messages);
  assert.ok(title.endsWith("…"));
  assert.ok(title.length <= 60);
  assert.equal(deriveConversationTitle([]), "محادثة جديدة");
});

test("deriveLastMessagePreview extracts the most recent message preview", () => {
  const messages: UIMessage[] = [
    { id: "m1", role: "user", parts: [{ type: "text", text: "السؤال الأول" }] },
    { id: "m2", role: "assistant", parts: [{ type: "text", text: "الإجابة الأخيرة" }] },
  ];
  assert.equal(deriveLastMessagePreview(messages), "الإجابة الأخيرة");
  assert.equal(truncateArabicText("   مرحبا   بكم   ", 50), "مرحبا بكم");
});

test("validateAssistantNoteInput enforces title and content lengths", () => {
  assert.equal(validateAssistantNoteInput({ title: "أ", content: "نص صحيح" }).ok, false);
  assert.equal(validateAssistantNoteInput({ title: "عنوان صحيح", content: "ا" }).ok, false);
  const valid = validateAssistantNoteInput({
    title: "  قاعدة الجمعة  ",
    content: "  تذكير بتكريم أكثر الطلاب التزاماً كل جمعة  ",
  });
  assert.deepEqual(valid, {
    ok: true,
    title: "قاعدة الجمعة",
    content: "تذكير بتكريم أكثر الطلاب التزاماً كل جمعة",
  });
});

test("normalizeStoredMessageRows parses serialized UIMessage parts safely and falls back to textContent", () => {
  const rows = normalizeStoredMessageRows([
    {
      id: "conv1:m1",
      role: "user",
      textContent: "مرحبا",
      partsJson: JSON.stringify([{ type: "text", text: "مرحبا" }]),
    },
    {
      id: "conv1:m2",
      role: "assistant",
      textContent: "أهلاً بك",
      partsJson: "{invalid-json",
    },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.role, "user");
  assert.deepEqual(rows[0]?.parts, [{ type: "text", text: "مرحبا" }]);
  assert.equal(rows[1]?.role, "assistant");
  assert.deepEqual(rows[1]?.parts, [{ type: "text", text: "أهلاً بك" }]);
});
