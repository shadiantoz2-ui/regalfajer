import { createFileRoute } from "@tanstack/react-router";
import { resolveSession, verifySameOriginMutation } from "@/lib/server/auth.server";
import { clearAssistantChatMessages, getAssistantChatMessages } from "@/lib/server/data.server";

function jsonError(status: number, message: string) {
  return Response.json({ error: { message } }, { status });
}

export const Route = createFileRoute("/api/assistant-chat")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = resolveSession(request);
        if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");
        if (session.role !== "admin") return jsonError(403, "المساعد متاح للمدير فقط");

        return Response.json(
          { messages: getAssistantChatMessages(session.id) },
          { headers: { "cache-control": "no-store" } },
        );
      },

      DELETE: async ({ request }) => {
        if (!verifySameOriginMutation(request)) {
          return jsonError(403, "طلب غير مصرّح به");
        }
        const session = resolveSession(request);
        if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");
        if (session.role !== "admin") return jsonError(403, "المساعد متاح للمدير فقط");

        clearAssistantChatMessages(session.id);
        return Response.json({ ok: true });
      },
    },
  },
});
