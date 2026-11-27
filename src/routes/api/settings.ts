import { createFileRoute } from "@tanstack/react-router";
import { resolveSession, verifySameOriginMutation } from "@/lib/server/auth.server";
import { getPublicLeaderboard, getResultsPublic, setResultsPublic } from "@/lib/server/data.server";

function jsonError(status: number, message: string) {
  return Response.json({ error: { message } }, { status });
}

export const Route = createFileRoute("/api/settings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          if (url.searchParams.get("public") === "1") {
            const leaderboard = await getPublicLeaderboard();
            return Response.json(leaderboard, {
              headers: { "cache-control": "no-store" },
            });
          }

          const session = await resolveSession(request);
          if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");
          if (session.role !== "admin") return jsonError(403, "هذه الصفحة متاحة للمدير فقط");

          const resultsPublic = await getResultsPublic();
          return Response.json(
            { results_public: resultsPublic },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (error) {
          console.error("GET /api/settings error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر تحميل الإعدادات");
        }
      },

      PUT: async ({ request }) => {
        if (!verifySameOriginMutation(request)) {
          return jsonError(403, "طلب غير مصرّح به");
        }
        try {
          const session = await resolveSession(request);
          if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");
          if (session.role !== "admin") return jsonError(403, "هذه العملية متاحة للمدير فقط");

          let body: Record<string, unknown>;
          try {
            body = (await request.json()) as Record<string, unknown>;
          } catch {
            return jsonError(400, "بيانات الطلب غير صالحة");
          }

          const value = Boolean(body["results_public"]);
          await setResultsPublic(value, session.id);
          return Response.json({ ok: true, results_public: value });
        } catch (error) {
          console.error("PUT /api/settings error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر حفظ الإعدادات");
        }
      },
    },
  },
});
