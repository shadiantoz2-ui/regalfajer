import type { UIMessage } from "ai";

export interface AssistantConversationSummary {
  id: string;
  title: string;
  messageCount: number;
  lastMessagePreview: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantNoteItem {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantDbStats {
  conversations: number;
  messages: number;
  notes: number;
  toolRuns: number;
}

export function extractMessageText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    if (
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      (part as { type?: unknown }).type === "text" &&
      "text" in part &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      const text = (part as { text: string }).text.trim();
      if (text) chunks.push(text);
    }
  }
  return chunks.join("\n").trim();
}

export function truncateArabicText(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

export function deriveConversationTitle(messages: readonly UIMessage[]): string {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const txt = extractMessageText(m.parts);
    if (txt) return truncateArabicText(txt, 60);
  }
  return "محادثة جديدة";
}

export function deriveLastMessagePreview(messages: readonly UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m) continue;
    const txt = extractMessageText(m.parts);
    if (txt) return truncateArabicText(txt, 110);
  }
  return "";
}

export function validateAssistantNoteInput(input: {
  title: string;
  content: string;
}): { ok: true; title: string; content: string } | { ok: false; error: string } {
  const title = input.title.replace(/\s+/g, " ").trim();
  const content = input.content.trim();
  if (title.length < 2 || title.length > 80) {
    return { ok: false, error: "اكتب عنوان الملاحظة بين حرفين و80 حرفاً" };
  }
  if (content.length < 2 || content.length > 1000) {
    return { ok: false, error: "اكتب نص الملاحظة بين حرفين و1000 حرف" };
  }
  return { ok: true, title, content };
}

export function normalizeStoredMessageRows(
  rows: ReadonlyArray<{ id: string; role: string; partsJson: string; textContent: string }>,
): UIMessage[] {
  const out: UIMessage[] = [];
  for (const row of rows) {
    const role: UIMessage["role"] =
      row.role === "assistant" ? "assistant" : row.role === "system" ? "system" : "user";
    let parts: UIMessage["parts"] = [];
    try {
      const parsed = JSON.parse(row.partsJson) as unknown;
      if (Array.isArray(parsed)) {
        parts = parsed as UIMessage["parts"];
      }
    } catch {
      parts = row.textContent ? [{ type: "text", text: row.textContent }] : [];
    }
    if (parts.length === 0 && row.textContent) {
      parts = [{ type: "text", text: row.textContent }];
    }
    out.push({
      id: row.id,
      role,
      parts,
    });
  }
  return out;
}
