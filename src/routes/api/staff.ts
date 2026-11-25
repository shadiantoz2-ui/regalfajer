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
        const session = resolveSession(request);
        if (!session) return jsonError(401, "انتهت الجلسة، سجّل الدخول أولاً");

        const url = new URL(request.url);
        const mode = url.searchParams.get("mode");
        const date = url.searchParams.get("date") ?? "";

        if (mode === "my-recordings") {
          return Response.json(
            { rows: listStaffDayRecordings(session.id, date) },
            { headers: { "cache-control": "no-store" } },
          );
        }

        if (session.role !== "admin") {
          return jsonError(403, "هذه الصفحة متاحة للمدير فقط");
        }

        if (mode === "recordings") {
          const staffId = url.searchParams.get("staffId") ?? "";
          return Response.json(
            { rows: listStaffDayRecordings(staffId, date) },
            { headers: { "cache-control": "no-store" } },
          );
        }

        return Response.json(
          { accounts: listStaffAccounts() },
          { headers: { "cache-control": "no-store" } },
        );
      },

      POST: async ({ request }) => {
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

        const name = typeof body["name"] === "string" ? body["name"] : "";
        const username = typeof body["username"] === "string" ? body["username"] : "";
        const password = typeof body["password"] === "string" ? body["password"] : "";
        const role = body["role"] === "admin" ? "admin" : "teacher";

        const res = createStaffAccount(session.id, { name, username, password, role });
        if (!res.ok) return jsonError(res.status, res.error);
        return Response.json({ ok: true, account: res.account }, { status: 201 });
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
        if (!id) return jsonError(400, "معرّف الحساب مطلوب");

        const patch: { name?: string; role?: "admin" | "teacher"; password?: string } = {};
        if (typeof body["name"] === "string") patch.name = body["name"];
        if (body["role"] === "admin" || body["role"] === "teacher") patch.role = body["role"];
        if (typeof body["password"] === "string" && body["password"].length > 0) {
          patch.password = body["password"];
        }

        const res = updateStaffAccount(session.id, id, patch);
        if (!res.ok) return jsonError(res.status, res.error);
        return Response.json({ ok: true, account: res.account });
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
            /* ignore empty body */
          }
        }
        if (!id) return jsonError(400, "معرّف الحساب مطلوب");

        const res = deleteStaffAccount(session.id, id);
        if (!res.ok) return jsonError(res.status, res.error);
        return Response.json({ ok: true });
      },
    },
  },
});
