import { createFileRoute } from "@tanstack/react-router";
import { isAssistantConfigured } from "@/lib/ai/assistant.server";
import {
  clearAllAssistantConversations,
  createAssistantConversation,
  createAssistantNote,
  deleteAssistantConversation,
  deleteAssistantNote,
  getAssistantConversationMessages,
  getAssistantDbStats,
  listAssistantNotes,
} from "@/lib/server/assistant-db.server";
import { resolveSession, verifySameOriginMutation } from "@/lib/server/auth.server";

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

          const url = new URL(request.url);
          const requestedConversationId = url.searchParams.get("conversationId");

          const [convData, notes, stats] = await Promise.all([
            getAssistantConversationMessages(session.id, requestedConversationId),
            listAssistantNotes(session.id),
            getAssistantDbStats(session.id),
          ]);

          return Response.json(
            {
              conversations: convData.conversations,
              activeConversationId: convData.activeConversationId,
              messages: convData.messages,
              notes,
              stats,
              configured: isAssistantConfigured(),
            },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (error) {
          console.error("GET /api/assistant-chat error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر تحميل بيانات المساعد");
        }
      },

      POST: async ({ request }) => {
        if (!verifySameOriginMutation(request)) {
          return jsonError(403, "طلب غير مصرّح به");
        }
        try {
          const session = await resolveSession(request);
          if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");
          if (session.role !== "admin") return jsonError(403, "المساعد متاح للمدير فقط");

          let body: Record<string, unknown>;
          try {
            body = (await request.json()) as Record<string, unknown>;
          } catch {
            return jsonError(400, "بيانات الطلب غير صالحة");
          }

          const action = typeof body["action"] === "string" ? body["action"] : "";

          if (action === "create_conversation") {
            const title = typeof body["title"] === "string" ? body["title"] : undefined;
            const conversation = await createAssistantConversation(session.id, title);
            const stats = await getAssistantDbStats(session.id);
            return Response.json({ ok: true, conversation, stats }, { status: 201 });
          }

          if (action === "add_note") {
            const title = typeof body["title"] === "string" ? body["title"] : "";
            const content = typeof body["content"] === "string" ? body["content"] : "";
            const res = await createAssistantNote(session.id, { title, content });
            if (!res.ok) return jsonError(400, res.error);
            const stats = await getAssistantDbStats(session.id);
            return Response.json({ ok: true, note: res.note, stats }, { status: 201 });
          }

          return jsonError(400, "إجراء غير مدعوم");
        } catch (error) {
          console.error("POST /api/assistant-chat error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر إتمام الطلب");
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

          const url = new URL(request.url);
          const noteId = url.searchParams.get("noteId");
          const conversationId = url.searchParams.get("conversationId");

          if (noteId) {
            const deleted = await deleteAssistantNote(session.id, noteId);
            if (!deleted) return jsonError(404, "الملاحظة غير موجودة");
            const stats = await getAssistantDbStats(session.id);
            return Response.json({ ok: true, stats });
          }

          if (conversationId) {
            await deleteAssistantConversation(session.id, conversationId);
            const stats = await getAssistantDbStats(session.id);
            return Response.json({ ok: true, stats });
          }

          await clearAllAssistantConversations(session.id);
          const stats = await getAssistantDbStats(session.id);
          return Response.json({ ok: true, stats });
        } catch (error) {
          console.error("DELETE /api/assistant-chat error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر مسح بيانات المساعد");
        }
      },
    },
  },
});
