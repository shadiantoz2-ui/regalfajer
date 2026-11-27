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
        try {
          const [needsSetup, user] = await Promise.all([
            hasAnyStaffAccount().then((has) => !has),
            resolveSession(request),
          ]);
          const token = user ? await signSessionToken(user.id) : null;
          return Response.json(
            { needsSetup, user, token },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (error) {
          console.error("GET /api/auth error:", error);
          return jsonError(503, "تعذّر الاتصال بقاعدة البيانات، حاول مرة أخرى");
        }
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

        try {
          if (action === "setup_primary_admin") {
            const name = typeof body["name"] === "string" ? body["name"] : "";
            const username = typeof body["username"] === "string" ? body["username"] : "";
            const password = typeof body["password"] === "string" ? body["password"] : "";

            const res = await setupPrimaryAdmin({ name, username, password });
            if (!res.ok) {
              return jsonError(res.status, res.error);
            }

            const token = await signSessionToken(res.user.id);
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

            const user = await authenticateStaffCredentials({ username, password });
            if (!user) {
              return jsonError(401, "اسم المستخدم أو كلمة المرور غير صحيحة");
            }

            const token = await signSessionToken(user.id);
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
        } catch (error) {
          console.error("POST /api/auth error:", error);
          return jsonError(500, error instanceof Error ? error.message : "تعذّر إتمام الطلب");
        }
      },
    },
  },
});
