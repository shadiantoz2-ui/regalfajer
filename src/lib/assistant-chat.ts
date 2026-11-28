/** Saved assistant conversations and notes for the signed-in manager. */
import { queryOptions } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { apiJson } from "./api-client";
import type {
  AssistantConversationSummary,
  AssistantDbStats,
  AssistantNoteItem,
} from "./assistant-helpers";

export interface AssistantChatPayload {
  conversations: AssistantConversationSummary[];
  activeConversationId: string | null;
  messages: UIMessage[];
  notes: AssistantNoteItem[];
  stats: AssistantDbStats;
  configured: boolean;
}

export const assistantChatQuery = (conversationId?: string | null) =>
  queryOptions({
    queryKey: ["assistant-chat", conversationId ?? "latest"],
    queryFn: async (): Promise<AssistantChatPayload> => {
      const qs = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
      return apiJson<AssistantChatPayload>(`/api/assistant-chat${qs}`);
    },
    staleTime: 10_000,
    gcTime: 0,
  });

export async function createAssistantConversationApi(title?: string): Promise<AssistantConversationSummary> {
  const res = await apiJson<{ ok: true; conversation: AssistantConversationSummary }>("/api/assistant-chat", {
    method: "POST",
    body: JSON.stringify({ action: "create_conversation", ...(title ? { title } : {}) }),
  });
  return res.conversation;
}

export async function deleteAssistantConversationApi(conversationId: string): Promise<void> {
  await apiJson<{ ok: true }>(`/api/assistant-chat?conversationId=${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
  });
}

export async function clearAssistantChat(): Promise<void> {
  await apiJson<{ ok: true }>("/api/assistant-chat", { method: "DELETE" });
}

export async function createAssistantNoteApi(input: { title: string; content: string }): Promise<AssistantNoteItem> {
  const res = await apiJson<{ ok: true; note: AssistantNoteItem }>("/api/assistant-chat", {
    method: "POST",
    body: JSON.stringify({ action: "add_note", ...input }),
  });
  return res.note;
}

export async function deleteAssistantNoteApi(noteId: string): Promise<void> {
  await apiJson<{ ok: true }>(`/api/assistant-chat?noteId=${encodeURIComponent(noteId)}`, {
    method: "DELETE",
  });
}

/** Turns a failed request body like {"error":{"message":"..."}} into the readable message. */
export function readableChatError(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    /* not JSON */
  }
  if (/failed to fetch|network/i.test(error.message)) return "تعذّر الاتصال، تحقق من الإنترنت";
  return error.message || "تعذّر الحصول على إجابة";
}
