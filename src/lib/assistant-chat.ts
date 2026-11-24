/** Saved assistant conversation for the signed-in manager (one conversation per account). */
import { queryOptions } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { supabase } from "@/integrations/supabase/client";

export const assistantChatQuery = () =>
  queryOptions({
    queryKey: ["assistant-chat"],
    queryFn: async (): Promise<UIMessage[]> => {
      const { data, error } = await supabase.from("assistant_chats").select("messages").maybeSingle();
      if (error) throw error;
      return Array.isArray(data?.messages) ? (data.messages as unknown as UIMessage[]) : [];
    },
    staleTime: Infinity,
    gcTime: 0,
  });

export async function clearAssistantChat() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  const { error } = await supabase.from("assistant_chats").delete().eq("user_id", data.user.id);
  if (error) throw error;
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
