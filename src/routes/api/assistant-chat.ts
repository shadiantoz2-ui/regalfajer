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
        try {
          const session = await resolveSession(request);
          if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");
          if (session.role !== "admin") return jsonError(403, "المساعد متاح للمدير فقط");

          const messages = await getAssistantChatMessages(session.id);
          return Response.json({ messages }, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          console.error("GET /api/assistant-chat error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر تحميل المحادثة");
        }
      },

      DELETE: async ({ request }) => {
        if (!verifySameOriginMutation(request)) {
          return jsonError(403, "طلب غير مصرّح به");
        }
        try {
          const session = await resolveSession(request);
          if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");
          if (session.role !== "admin") return jsonError(403, "المساعد متاح للمدير فقط");

          await clearAssistantChatMessages(session.id);
          return Response.json({ ok: true });
        } catch (error) {
          console.error("DELETE /api/assistant-chat error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر مسح المحادثة");
        }
      },
    },
  },
});
