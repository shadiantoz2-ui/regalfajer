import { createFileRoute } from "@tanstack/react-router";
import { resolveSession, verifySameOriginMutation } from "@/lib/server/auth.server";
import {
  getPublicLeaderboard,
  getResultsPublic,
  getTeacherEntryEnabled,
  setResultsPublic,
  setTeacherEntryEnabled,
} from "@/lib/server/data.server";

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

          if (url.searchParams.get("entry") === "1") {
            const teacherEntryEnabled = await getTeacherEntryEnabled();
            return Response.json(
              { teacher_entry_enabled: teacherEntryEnabled },
              { headers: { "cache-control": "no-store" } },
            );
          }

          if (session.role !== "admin") return jsonError(403, "هذه الصفحة متاحة للمدير فقط");

          const [resultsPublic, teacherEntryEnabled] = await Promise.all([
            getResultsPublic(),
            getTeacherEntryEnabled(),
          ]);
          return Response.json(
            { results_public: resultsPublic, teacher_entry_enabled: teacherEntryEnabled },
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

          const hasResultsPublic = typeof body["results_public"] === "boolean";
          const hasTeacherEntry = typeof body["teacher_entry_enabled"] === "boolean";
          if (!hasResultsPublic && !hasTeacherEntry) {
            return jsonError(400, "بيانات الإعدادات غير صالحة");
          }

          if (hasResultsPublic) {
            await setResultsPublic(body["results_public"] as boolean, session.id);
          }
          if (hasTeacherEntry) {
            await setTeacherEntryEnabled(body["teacher_entry_enabled"] as boolean, session.id);
          }

          const [resultsPublic, teacherEntryEnabled] = await Promise.all([
            getResultsPublic(),
            getTeacherEntryEnabled(),
          ]);
          return Response.json({
            ok: true,
            results_public: resultsPublic,
            teacher_entry_enabled: teacherEntryEnabled,
          });
        } catch (error) {
          console.error("PUT /api/settings error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر حفظ الإعدادات");
        }
      },
    },
  },
});
