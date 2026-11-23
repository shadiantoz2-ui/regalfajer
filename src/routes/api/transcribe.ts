import { createFileRoute } from "@tanstack/react-router";

const MAX_BYTES = 10 * 1024 * 1024;
const MODEL = "openai/gpt-transcribe";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return Response.json({ error: { message: "Missing configuration" } }, { status: 500 });

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
