import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Only signed-in staff may use voice recognition (it costs credits). */
async function isStaffRequest(request: Request): Promise<boolean> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token.split(".").length !== 3) return false;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return false;
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  const { data: userData } = await client.auth.getUser(token);
  if (!userData.user) return false;
  const { data } = await client.rpc("is_staff", { _user_id: userData.user.id });
  return data === true;
}

const MAX_BYTES = 10 * 1024 * 1024;
const MODEL = "openai/gpt-transcribe";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return Response.json({ error: { message: "Missing configuration" } }, { status: 500 });

        if (!(await isStaffRequest(request))) {
          return Response.json({ error: { message: "سجّل الدخول أولاً" } }, { status: 401 });
        }

        const declared = Number(request.headers.get("content-length") ?? "0");
        if (declared > MAX_BYTES + 64 * 1024) {
          return Response.json({ error: { message: "الملف كبير جداً" } }, { status: 413 });
        }
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File) || !file.size || file.size > MAX_BYTES || !file.type.startsWith("audio/")) {
          return Response.json({ error: { message: "ملف صوتي غير صالح" } }, { status: 400 });
        }

        const upstream = new FormData();
        upstream.append("model", MODEL);
        upstream.append("file", file, file.name);
        upstream.append("response_format", "json");
        upstream.append("stream", "true");
        upstream.append("language", "ar");
        upstream.append(
          "prompt",
          "طالب يقول اسمه الثلاثي باللغة العربية، مثل: محمد أحمد العتيبي. اكتب الاسم فقط بالحروف العربية.",
        );

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: upstream,
          signal: request.signal,
        });
        return new Response(res.body, {
          status: res.status,
          headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
        });
      },
    },
  },
});
