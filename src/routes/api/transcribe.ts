import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { createFileRoute } from "@tanstack/react-router";
import {
  cleanDisplayName,
  collapseRepeatedPhrases,
  needsHamzaOrMaddaReview,
  normalizeName,
  restoreArabicHamzaAndMadda,
} from "@/lib/arabic";
import { resolveSession, verifySameOriginMutation } from "@/lib/server/auth.server";

/** Only signed-in staff may use voice recognition. */
function isStaffRequest(request: Request): boolean {
  return resolveSession(request) !== null;
}

const MAX_BYTES = 10 * 1024 * 1024;
const GEMINI_TRANSCRIBE_MODEL = "gemini-3.5-transcribe";
const GEMINI_ORTHOGRAPHY_MODEL = "gemini-4-hydrogen";
const LOVABLE_TRANSCRIBE_MODEL = "openai/gpt-transcribe";

let cachedAiKey: string | undefined;
let cachedAiClient: GoogleGenAI | undefined;

function getGeminiClient(apiKey: string): GoogleGenAI {
  if (cachedAiClient && cachedAiKey === apiKey) return cachedAiClient;
  cachedAiKey = apiKey;
  cachedAiClient = new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
  return cachedAiClient;
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null) {
    if ("status" in err && typeof err.status === "number") return err.status;
    if ("statusCode" in err && typeof err.statusCode === "number") return err.statusCode;
  }
  return undefined;
}

const NOISE_ONLY_PATTERN =
  /^(?:EMPTY|none|silence|unclear|صمت|موسيقى|غير واضح|لا يوجد صوت|بدون صوت|تشويش)$/i;

function sanitizeTranscript(raw: string): string {
  const trimmed = raw
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/^(?:الاسم(?:\s+المسموع)?|اسمي|اسم الطالب|الطالب)\s*[:：-]?\s*/u, "")
    .trim();

  if (!trimmed || NOISE_ONLY_PATTERN.test(trimmed)) return "";

  // Reject non-Arabic hallucinations such as English descriptions
  if (!/[\u0621-\u064A]/.test(trimmed)) return "";

  const collapsed = collapseRepeatedPhrases(trimmed);
  if (!collapsed || NOISE_ONLY_PATTERN.test(collapsed)) return "";
  return restoreArabicHamzaAndMadda(collapsed);
}

async function refineArabicHamzaAndMaddaWithAi(ai: GoogleGenAI, candidate: string): Promise<string> {
  if (!candidate || !needsHamzaOrMaddaReview(candidate)) return candidate;
  try {
    const response = await ai.models.generateContent({
      model: GEMINI_ORTHOGRAPHY_MODEL,
      contents: `صحّح فقط كتابة الهمزات (أ، إ، ؤ، ئ، ء) والمدة (آ) في الاسم العربي التالي دون تغيير الكلمات أو إبدالها أو إضافة أي كلام أو تشكيل: "${candidate}"`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        systemInstruction:
          "أنت مدقق إملائي للأسماء العربية. مهمتك الوحيدة ضبط همزة القطع والوصل والهمزة المتوسطة والمتطرفة والمدة (أ، إ، آ، ؤ، ئ، ء) على نفس الكلمات تماماً (مثل: أحمد، إبراهيم، أسامة، آدم، آل، آلاء، فؤاد، مؤمن، وائل، رائد، أرسلان، إيثار) مع إبقاء ابن/اسم بهمزة وصل. لا تغيّر أي اسم إلى اسم آخر ولا تضف تشكيل الحركات.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            correctedName: {
              type: Type.STRING,
              description: "The exact same Arabic name with accurate hamzas and maddas only.",
            },
          },
        },
      },
    });
    const parsed = JSON.parse((response.text ?? "{}").trim()) as { correctedName?: unknown };
    const corrected = cleanDisplayName(String(parsed.correctedName ?? ""));
    if (corrected && normalizeName(corrected) === normalizeName(candidate)) {
      return restoreArabicHamzaAndMadda(corrected);
    }
  } catch {
    /* keep deterministic restoration on orthography fallback failure */
  }
  return candidate;
}

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      GET: async () => {
        const geminiKey = process.env["GEMINI_API_KEY"]?.trim();
        const lovableKey = process.env["LOVABLE_API_KEY"]?.trim();
        const configured = Boolean(geminiKey || (lovableKey && lovableKey.length >= 20));
        return Response.json({ configured });
      },
      POST: async ({ request }) => {
        if (!verifySameOriginMutation(request)) {
          return Response.json({ error: { message: "طلب غير مصرّح به" } }, { status: 403 });
        }
        if (!isStaffRequest(request)) {
          return Response.json({ error: { message: "انتهت الجلسة، سجّل الدخول أولاً" } }, { status: 401 });
        }

        const geminiKey = process.env["GEMINI_API_KEY"]?.trim();
        const rawLovableKey = process.env["LOVABLE_API_KEY"]?.trim();
        const lovableKey = rawLovableKey && rawLovableKey.length >= 20 ? rawLovableKey : undefined;
        if (!geminiKey && !lovableKey) {
          return Response.json(
            {
              error: {
                message: "خدمة التعرف على الصوت غير مفعّلة: تأكد من إضافة GEMINI_API_KEY في الإعدادات",
              },
            },
            { status: 503 },
          );
        }

        const declared = Number(request.headers.get("content-length") ?? "0");
        if (declared > MAX_BYTES + 64 * 1024) {
          return Response.json({ error: { message: "الملف الصوتي كبير جداً" } }, { status: 413 });
        }

        const form = await request.formData();
        const file = form.get("file");
        const hasAudioExt = file instanceof File && /\.(wav|webm|m4a|mp4|ogg|mp3)$/i.test(file.name);
        const isAudio =
          file instanceof File &&
          file.size > 0 &&
          file.size <= MAX_BYTES &&
          (file.type.startsWith("audio/") || file.type === "video/webm" || file.type === "" || hasAudioExt);
        if (!isAudio) {
          return Response.json({ error: { message: "ملف صوتي غير صالح" } }, { status: 400 });
        }

        if (geminiKey) {
          try {
            const ai = getGeminiClient(geminiKey);
            const rawMime = file.type.split(";")[0]?.trim() || (file.name.endsWith(".wav") ? "audio/wav" : "audio/webm");
            const mimeType = rawMime === "video/webm" ? "audio/webm" : rawMime;
            const base64Audio = Buffer.from(await file.arrayBuffer()).toString("base64");

            const audioParts = [
              {
                inlineData: {
                  mimeType,
                  data: base64Audio,
                },
              },
              {
                text: [
                  "Listen carefully to this Arabic audio clip where a student says their name and family name (first name may be compound such as محمد أمين or عبد الكريم, with no father's name).",
                  "Transcribe ONLY the exact spoken Arabic name in clean standard Arabic script.",
                  "Pay strict attention to Arabic hamzas (أ، إ، ؤ، ئ، ء) and madda (آ), e.g. أحمد، إبراهيم، أسامة، آدم، آلاء، آل علي، فؤاد، مؤمن، وائل، رائد، علاء، أسماء.",
                  "Do NOT add harakat/tashkeel, punctuation, prefixes, explanations, or repeated words.",
                  "If the audio contains only silence, breathing, or unintelligible noise, reply with exactly: EMPTY",
                ].join(" "),
              },
            ];

            let response;
            try {
              response = await ai.models.generateContent({
                model: GEMINI_TRANSCRIBE_MODEL,
                contents: { parts: audioParts },
              });
            } catch (primaryErr) {
              if (extractStatus(primaryErr) !== 404) throw primaryErr;
              response = await ai.models.generateContent({
                model: GEMINI_ORTHOGRAPHY_MODEL,
                contents: { parts: audioParts },
                config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
              });
            }

            const initialText = sanitizeTranscript(response.text ?? "");
            if (!initialText) {
              return Response.json({ text: "" });
            }

            const finalText = await refineArabicHamzaAndMaddaWithAi(ai, initialText);
            return Response.json({ text: finalText });
          } catch (err) {
            console.error("Gemini transcribe error:", err);
            const status = extractStatus(err);
            if (status === 429) {
              return Response.json(
                { error: { message: "طلبات كثيرة، انتظر لحظة ثم أعد المحاولة" } },
                { status: 429 },
              );
            }
            if (status === 400 || status === 401 || status === 403) {
              return Response.json(
                { error: { message: "تحقّق من مفتاح خدمة التعرف على الصوت (GEMINI_API_KEY) في الإعدادات" } },
                { status: status === 400 ? 403 : status },
              );
            }
            return Response.json(
              { error: { message: "تعذّر التعرف على الصوت، حاول مرة أخرى" } },
              { status: 502 },
            );
          }
        }

        const upstream = new FormData();
        upstream.append("model", LOVABLE_TRANSCRIBE_MODEL);
        upstream.append("file", file, file.name);
        upstream.append("response_format", "json");
        upstream.append("stream", "true");
        upstream.append("language", "ar");
        upstream.append(
          "prompt",
          "طالب يقول اسمه وكنيته باللغة العربية الفصحى (قد يكون الاسم مركباً مثل محمد أمين أو عبد الكريم، بدون اسم أب) مع كتابة الهمزات والمدّات بشكل صحيح، مثل: أسامة العلاوي، محمد أمين الزهوري. اكتب الاسم فقط دون تكرار.",
        );

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${lovableKey}` },
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
