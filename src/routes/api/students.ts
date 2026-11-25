import { createFileRoute } from "@tanstack/react-router";
import { resolveSession, verifySameOriginMutation } from "@/lib/server/auth.server";
import {
  addStudent,
  deleteStudent,
  importHistoricalAttendanceSeed,
  listStudents,
  renameStudent,
} from "@/lib/server/data.server";

function jsonError(status: number, message: string) {
  return Response.json({ error: { message } }, { status });
}

export const Route = createFileRoute("/api/students")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = resolveSession(request);
        if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");
        return Response.json(
          { students: listStudents() },
          { headers: { "cache-control": "no-store" } },
        );
      },

      POST: async ({ request }) => {
        if (!verifySameOriginMutation(request)) {
          return jsonError(403, "طلب غير مصرّح به");
        }
        const session = resolveSession(request);
        if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return jsonError(400, "بيانات الطلب غير صالحة");
        }

        if (body["action"] === "import_seed") {
          if (session.role !== "admin") {
            return jsonError(403, "هذه العملية متاحة للمدير فقط");
          }
          const summary = importHistoricalAttendanceSeed();
          return Response.json(summary);
        }

        const fullName = typeof body["fullName"] === "string" ? body["fullName"] : "";
        const result = addStudent(fullName, session.id);
        return Response.json(result, { status: result.status === "created" ? 201 : 200 });
      },

      PATCH: async ({ request }) => {
        if (!verifySameOriginMutation(request)) {
          return jsonError(403, "طلب غير مصرّح به");
        }
        const session = resolveSession(request);
        if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");
        if (session.role !== "admin") return jsonError(403, "هذه العملية متاحة للمدير فقط");

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return jsonError(400, "بيانات الطلب غير صالحة");
        }

        const id = typeof body["id"] === "string" ? body["id"].trim() : "";
        const fullName = typeof body["fullName"] === "string" ? body["fullName"] : "";
        if (!id) return jsonError(400, "معرّف الطالب مطلوب");

        const result = renameStudent(id, fullName);
        return Response.json(result);
      },

      DELETE: async ({ request }) => {
        if (!verifySameOriginMutation(request)) {
          return jsonError(403, "طلب غير مصرّح به");
        }
        const session = resolveSession(request);
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
        if (!id) return jsonError(400, "معرّف الطالب مطلوب");

        const deleted = deleteStudent(id);
        if (!deleted) return jsonError(404, "الطالب غير موجود");
        return Response.json({ ok: true });
      },
    },
  },
});
