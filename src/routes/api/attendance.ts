import { createFileRoute } from "@tanstack/react-router";
import { resolveSession, verifySameOriginMutation } from "@/lib/server/auth.server";
import {
  deleteAttendance,
  listAllAttendance,
  listDayAttendance,
  listStudentAttendance,
  recordAttendance,
  recordAttendanceBulk,
  recordStudentPastDates,
} from "@/lib/server/data.server";

function jsonError(status: number, message: string) {
  return Response.json({ error: { message } }, { status });
}

export const Route = createFileRoute("/api/attendance")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await resolveSession(request);
          if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");
          if (session.role !== "admin") return jsonError(403, "عرض السجلات الكاملة متاح للمدير فقط");

          const url = new URL(request.url);
          const date = url.searchParams.get("date");
          if (date) {
            const rows = await listDayAttendance(date);
            return Response.json({ rows }, { headers: { "cache-control": "no-store" } });
          }

          const studentId = url.searchParams.get("studentId");
          if (studentId) {
            const rows = await listStudentAttendance(studentId);
            return Response.json({ rows }, { headers: { "cache-control": "no-store" } });
          }

          const from = url.searchParams.get("from") || undefined;
          const to = url.searchParams.get("to") || undefined;
          const rows = await listAllAttendance(from, to);
          return Response.json({ rows }, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          console.error("GET /api/attendance error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر تحميل سجلات الحضور");
        }
      },

      POST: async ({ request }) => {
        if (!verifySameOriginMutation(request)) {
          return jsonError(403, "طلب غير مصرّح به");
        }
        try {
          const session = await resolveSession(request);
          if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");

          let body: Record<string, unknown>;
          try {
            body = (await request.json()) as Record<string, unknown>;
          } catch {
            return jsonError(400, "بيانات الطلب غير صالحة");
          }

          const mode = typeof body["mode"] === "string" ? body["mode"] : "single";

          if (mode === "past_dates") {
            if (session.role !== "admin") {
              return jsonError(403, "تسجيل الأيام السابقة متاح للمدير فقط");
            }
            const studentId = typeof body["studentId"] === "string" ? body["studentId"].trim() : "";
            const rawDates = Array.isArray(body["dates"])
              ? body["dates"].filter((d): d is string => typeof d === "string")
              : [];
            const maxDate =
              typeof body["maxDate"] === "string" ? body["maxDate"].trim() : new Date().toISOString().slice(0, 10);
            if (!studentId) return jsonError(400, "معرّف الطالب مطلوب");

            const result = await recordStudentPastDates(studentId, rawDates, maxDate, session);
            return Response.json(result);
          }

          if (mode === "bulk") {
            const studentIds = Array.isArray(body["studentIds"])
              ? body["studentIds"].filter((id): id is string => typeof id === "string")
              : [];
            const date = typeof body["date"] === "string" ? body["date"].trim() : "";
            const result = await recordAttendanceBulk(studentIds, date, session);
            return Response.json(result);
          }

          const studentId = typeof body["studentId"] === "string" ? body["studentId"].trim() : "";
          const date = typeof body["date"] === "string" ? body["date"].trim() : "";
          if (!studentId || !date) return jsonError(400, "بيانات الحضور ناقصة");

          const result = await recordAttendance(studentId, date, session);
          if (result.status === "not_found") return jsonError(404, "الطالب غير موجود");
          return Response.json({ status: result.status });
        } catch (error) {
          console.error("POST /api/attendance error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر تسجيل الحضور");
        }
      },

      DELETE: async ({ request }) => {
        if (!verifySameOriginMutation(request)) {
          return jsonError(403, "طلب غير مصرّح به");
        }
        try {
          const session = await resolveSession(request);
          if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");
          if (session.role !== "admin") return jsonError(403, "هذه العملية متاحة للمدير فقط");

          const url = new URL(request.url);
          let id = url.searchParams.get("id")?.trim() ?? "";
          if (!id) {
            try {
              const body = (await request.json()) as Record<string, unknown>;
              if (typeof body["id"] === "string") id = body["id"].trim();
            } catch {
              /* ignore */
            }
          }
          if (!id) return jsonError(400, "معرّف السجل مطلوب");

          const deleted = await deleteAttendance(id);
          if (!deleted) return jsonError(404, "السجل غير موجود");
          return Response.json({ ok: true });
        } catch (error) {
          console.error("DELETE /api/attendance error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر إلغاء الحضور");
        }
      },
    },
  },
});
