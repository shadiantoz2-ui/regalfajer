import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  deriveConversationTitle,
  deriveLastMessagePreview,
  extractMessageText,
  normalizeStoredMessageRows,
  validateAssistantNoteInput,
} from "../assistant-helpers";
import { convertUIMessagesToGeminiContents, handleAssistant } from "./assistant.server";

describe("Assistant Gemini adapter", () => {
  it("converts AI SDK UIMessages into Gemini Content turns while ignoring empty/non-text parts", () => {
    const messages: UIMessage[] = [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "من أكثر 10 طلاب حضوراً؟" }],
      },
      {
        id: "m2",
        role: "assistant",
        parts: [
          {
            type: "tool-ranking",
            toolCallId: "tc1",
            state: "output-available",
            input: { order: "most", limit: 10 },
            output: { rows: [] },
          } as unknown as UIMessage["parts"][number],
          { type: "text", text: "أكثر الطلاب حضوراً هم أويس جنيد وحمزة الغربي." },
        ],
      },
      {
        id: "m3",
        role: "user",
        parts: [{ type: "text", text: "كم يوماً حضر أويس؟" }],
      },
    ];

    expect(convertUIMessagesToGeminiContents(messages)).toEqual([
      { role: "user", parts: [{ text: "من أكثر 10 طلاب حضوراً؟" }] },
      { role: "model", parts: [{ text: "أكثر الطلاب حضوراً هم أويس جنيد وحمزة الغربي." }] },
      { role: "user", parts: [{ text: "كم يوماً حضر أويس؟" }] },
    ]);
  });

  it("rejects unauthenticated requests with 403 JSON before checking API keys", async () => {
    const req = new Request("http://localhost:3000/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    const res = await handleAssistant(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe("المساعد متاح للمدير فقط");
  });

  it("merges consecutive user turns when an intermediate assistant message has no text", () => {
    const messages: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "السؤال الأول" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-overview",
            toolCallId: "t1",
            state: "output-available",
            input: {},
            output: { students: 72 },
          } as unknown as UIMessage["parts"][number],
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "السؤال الثاني" }] },
    ];
    expect(convertUIMessagesToGeminiContents(messages)).toEqual([
      { role: "user", parts: [{ text: "السؤال الأول" }, { text: "السؤال الثاني" }] },
    ]);
  });

  it("extracts text, derives conversation metadata, validates notes, and normalizes stored message rows", () => {
    const msgs: UIMessage[] = [
      { id: "m1", role: "user", parts: [{ type: "text", text: "من أكثر الطلاب حضوراً؟" }] },
      { id: "m2", role: "assistant", parts: [{ type: "text", text: "حمزة الغربي في الصدارة." }] },
    ];
    expect(extractMessageText(msgs[0]?.parts)).toBe("من أكثر الطلاب حضوراً؟");
    expect(deriveConversationTitle(msgs)).toBe("من أكثر الطلاب حضوراً؟");
    expect(deriveLastMessagePreview(msgs)).toBe("حمزة الغربي في الصدارة.");
    expect(validateAssistantNoteInput({ title: "أ", content: "ملاحظة" }).ok).toBe(false);
    expect(validateAssistantNoteInput({ title: "قاعدة", content: "تفاصيل القاعدة" })).toEqual({
      ok: true,
      title: "قاعدة",
      content: "تفاصيل القاعدة",
    });

    const normalized = normalizeStoredMessageRows([
      {
        id: "c1:m1",
        role: "user",
        textContent: "مرحبا",
        partsJson: JSON.stringify([{ type: "text", text: "مرحبا" }]),
      },
      {
        id: "c1:m2",
        role: "assistant",
        textContent: "أهلاً",
        partsJson: "corrupted",
      },
    ]);
    expect(normalized).toHaveLength(2);
    expect(normalized[1]?.parts).toEqual([{ type: "text", text: "أهلاً" }]);
  });
});
