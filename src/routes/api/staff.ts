import { createFileRoute } from "@tanstack/react-router";
import {
  createStaffAccount,
  deleteStaffAccount,
  listStaffAccounts,
  resolveSession,
  updateStaffAccount,
  verifySameOriginMutation,
} from "@/lib/server/auth.server";
import { listStaffDayRecordings } from "@/lib/server/data.server";

function jsonError(status: number, message: string) {
  return Response.json({ error: { message } }, { status });
}

export const Route = createFileRoute("/api/staff")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await resolveSession(request);
          if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");

          const url = new URL(request.url);
          const mode = url.searchParams.get("mode");
          const date = url.searchParams.get("date") ?? "";

          if (mode === "my-recordings") {
            const rows = await listStaffDayRecordings(session.id, date);
            return Response.json({ rows }, { headers: { "cache-control": "no-store" } });
          }

          if (session.role !== "admin") {
            return jsonError(403, "هذه الصفحة متاحة للمدير فقط");
          }

          if (mode === "recordings") {
            const staffId = url.searchParams.get("staffId") ?? "";
            const rows = await listStaffDayRecordings(staffId, date);
            return Response.json({ rows }, { headers: { "cache-control": "no-store" } });
          }

          const accounts = await listStaffAccounts();
          return Response.json({ accounts }, { headers: { "cache-control": "no-store" } });
        } catch (error) {
          console.error("GET /api/staff error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر تحميل بيانات الطاقم");
        }
      },

      POST: async ({ request }) => {
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

          const name = typeof body["name"] === "string" ? body["name"] : "";
          const username = typeof body["username"] === "string" ? body["username"] : "";
          const password = typeof body["password"] === "string" ? body["password"] : "";
          const role = body["role"] === "admin" ? "admin" : "teacher";

          const res = await createStaffAccount(session.id, { name, username, password, role });
          if (!res.ok) return jsonError(res.status, res.error);
          return Response.json({ ok: true, account: res.account }, { status: 201 });
        } catch (error) {
          console.error("POST /api/staff error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر إنشاء الحساب");
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
          if (!id) return jsonError(400, "معرّف الحساب مطلوب");

          const patch: { name?: string; role?: "admin" | "teacher"; password?: string } = {};
          if (typeof body["name"] === "string") patch.name = body["name"];
          if (body["role"] === "admin" || body["role"] === "teacher") patch.role = body["role"];
          if (typeof body["password"] === "string" && body["password"].length > 0) {
            patch.password = body["password"];
          }

          const res = await updateStaffAccount(session.id, id, patch);
          if (!res.ok) return jsonError(res.status, res.error);
          return Response.json({ ok: true, account: res.account });
        } catch (error) {
          console.error("PATCH /api/staff error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر تحديث الحساب");
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
              /* ignore empty body */
            }
          }
          if (!id) return jsonError(400, "معرّف الحساب مطلوب");

          const res = await deleteStaffAccount(session.id, id);
          if (!res.ok) return jsonError(res.status, res.error);
          return Response.json({ ok: true });
        } catch (error) {
          console.error("DELETE /api/staff error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر حذف الحساب");
        }
      },
    },
  },
});
