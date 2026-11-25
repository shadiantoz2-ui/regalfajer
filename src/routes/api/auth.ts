import { createFileRoute } from "@tanstack/react-router";
import {
  authenticateStaffCredentials,
  buildClearSessionCookieHeader,
  buildSessionCookieHeader,
  hasAnyStaffAccount,
  resolveSession,
  setupPrimaryAdmin,
  signSessionToken,
  verifySameOriginMutation,
} from "@/lib/server/auth.server";

function jsonError(status: number, message: string) {
  return Response.json({ error: { message } }, { status });
}

export const Route = createFileRoute("/api/auth")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const needsSetup = !hasAnyStaffAccount();
        const user = resolveSession(request);
        const token = user ? signSessionToken(user.id) : null;
        return Response.json(
          { needsSetup, user, token },
          { headers: { "cache-control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        if (!verifySameOriginMutation(request)) {
          return jsonError(403, "طلب غير مصرّح به");
        }

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return jsonError(400, "بيانات الطلب غير صالحة");
        }

        const action = typeof body["action"] === "string" ? body["action"] : "";

        if (action === "logout") {
          return Response.json(
            { ok: true },
            {
              headers: {
                "set-cookie": buildClearSessionCookieHeader(request),
                "cache-control": "no-store",
              },
            },
          );
        }

        if (action === "setup_primary_admin") {
          const name = typeof body["name"] === "string" ? body["name"] : "";
          const username = typeof body["username"] === "string" ? body["username"] : "";
          const password = typeof body["password"] === "string" ? body["password"] : "";

          const res = setupPrimaryAdmin({ name, username, password });
          if (!res.ok) {
            return jsonError(res.status, res.error);
          }

          const token = signSessionToken(res.user.id);
          return Response.json(
            { ok: true, user: res.user, token },
            {
              status: 201,
              headers: {
                "set-cookie": buildSessionCookieHeader(request, token),
                "cache-control": "no-store",
              },
            },
          );
        }

        if (action === "login") {
          const username = typeof body["username"] === "string" ? body["username"] : "";
          const password = typeof body["password"] === "string" ? body["password"] : "";

          if (!username.trim() || !password) {
            return jsonError(400, "أدخل اسم المستخدم وكلمة المرور");
          }

          const user = authenticateStaffCredentials({ username, password });
          if (!user) {
            return jsonError(401, "اسم المستخدم أو كلمة المرور غير صحيحة");
          }

          const token = signSessionToken(user.id);
          return Response.json(
            { ok: true, user, token },
            {
              headers: {
                "set-cookie": buildSessionCookieHeader(request, token),
                "cache-control": "no-store",
              },
            },
          );
        }

        return jsonError(400, "إجراء غير مدعوم");
      },
    },
  },
});
