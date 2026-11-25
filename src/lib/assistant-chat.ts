/** Saved assistant conversation for the signed-in manager (one conversation per account). */
import { queryOptions } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { apiJson } from "./api-client";

export const assistantChatQuery = () =>
  queryOptions({
    queryKey: ["assistant-chat"],
    queryFn: async (): Promise<UIMessage[]> => {
      const res = await apiJson<{ messages: UIMessage[] }>("/api/assistant-chat");
      return res.messages;
    },
    staleTime: Infinity,
    gcTime: 0,
  });

export async function clearAssistantChat() {
  await apiJson<{ ok: true }>("/api/assistant-chat", { method: "DELETE" });
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
