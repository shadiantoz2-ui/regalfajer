import { createFileRoute } from "@tanstack/react-router";
import { resolveSession, verifySameOriginMutation } from "@/lib/server/auth.server";
import { addStudent, deleteStudent, listStudents, renameStudent } from "@/lib/server/data.server";

function jsonError(status: number, message: string) {
  return Response.json({ error: { message } }, { status });
}

export const Route = createFileRoute("/api/students")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await resolveSession(request);
          if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");
          const students = await listStudents();
          return Response.json({ students }, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          console.error("GET /api/students error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر تحميل قائمة الطلاب");
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

          const fullName = typeof body["fullName"] === "string" ? body["fullName"] : "";
          const result = await addStudent(fullName, session.id);
          return Response.json(result, { status: result.status === "created" ? 201 : 200 });
        } catch (error) {
          console.error("POST /api/students error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر إضافة الطالب");
        }
      },

      PATCH: async ({ request }) => {
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

          const id = typeof body["id"] === "string" ? body["id"].trim() : "";
          const fullName = typeof body["fullName"] === "string" ? body["fullName"] : "";
          if (!id) return jsonError(400, "معرّف الطالب مطلوب");

          const result = await renameStudent(id, fullName);
          return Response.json(result);
        } catch (error) {
          console.error("PATCH /api/students error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر تعديل اسم الطالب");
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
          if (!id) return jsonError(400, "معرّف الطالب مطلوب");

          const deleted = await deleteStudent(id);
          if (!deleted) return jsonError(404, "الطالب غير موجود");
          return Response.json({ ok: true });
        } catch (error) {
          console.error("DELETE /api/students error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر حذف الطالب");
        }
      },
    },
  },
});
