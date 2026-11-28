import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { createFileRoute } from "@tanstack/react-router";
import {
  collapseRepeatedPhrases,
  restoreArabicHamzaAndMadda,
} from "@/lib/arabic";
import { resolveSession, verifySameOriginMutation } from "@/lib/server/auth.server";
import {
  createConcurrencyLimiter,
  extractApiErrorStatus,
  GEMINI_TRANSCRIBE_MODELS,
  ModelCooldownTracker,
  QueueOverloadedError,
  shouldFallbackToNextModel,
  UpstreamTimeoutError,
  withTimeout,
} from "@/lib/server/transcribe-resilience";

/** Only signed-in staff may use voice recognition. */
async function isStaffRequest(request: Request): Promise<boolean> {
  return (await resolveSession(request)) !== null;
}

const MAX_BYTES = 10 * 1024 * 1024;
const LOVABLE_TRANSCRIBE_MODEL = "openai/gpt-transcribe";
const MODEL_ATTEMPT_TIMEOUT_MS = 10_000;

const modelCooldowns = new ModelCooldownTracker(GEMINI_TRANSCRIBE_MODELS);
const transcribeLimiter = createConcurrencyLimiter(6, 20);

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

function modelConfigFor(model: string) {
  if (model === "gemini-4-hydrogen") {
    return { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } };
  }
  if (model === "gemini-3.1-flash-lite") {
    return { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } };
  }
  return undefined;
}

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      GET: async () => {
        const geminiKey = process.env["GEMINI_API_KEY"]?.trim();
        const lovableKey = process.env["LOVABLE_API_KEY"]?.trim();
        const hasLovable = Boolean(lovableKey && lovableKey.length >= 20);
        const configured = Boolean(geminiKey || hasLovable);
        const availableGemini = geminiKey ? modelCooldowns.getAvailableModels().length > 0 : false;
        const availableNow = Boolean(availableGemini || hasLovable);
        const retryAfterSeconds =
          geminiKey && !availableNow ? modelCooldowns.getShortestCooldownRemainingSeconds() : 0;
        return Response.json({ configured, availableNow, retryAfterSeconds });
      },
      POST: async ({ request }) => {
        if (!verifySameOriginMutation(request)) {
          return Response.json({ error: { message: "طلب غير مصرّح به" } }, { status: 403 });
        }
        if (!(await isStaffRequest(request))) {
          return Response.json({ error: { message: "انتهت الجلسة، سجّل الدخول أولاً" } }, { status: 401 });
        }

        const geminiKey = process.env["GEMINI_API_KEY"]?.trim();
        const rawLovableKey = process.env["LOVABLE_API_KEY"]?.trim();
        const lovableKey = rawLovableKey && rawLovableKey.length >= 20 ? rawLovableKey : undefined;
        if (!geminiKey && !lovableKey) {
          return Response.json(
            {
              error: {
                code: "NOT_CONFIGURED",
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

        let geminiExhausted = false;
        let retryAfterSeconds = 0;

        if (geminiKey) {
          const candidates = modelCooldowns.getAvailableModels();
          if (candidates.length === 0) {
            geminiExhausted = true;
            retryAfterSeconds = modelCooldowns.getShortestCooldownRemainingSeconds();
          } else {
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

              const transcript = await transcribeLimiter.run(async () => {
                let lastErr: unknown;
                for (const model of candidates) {
                  const config = modelConfigFor(model);
                  try {
                    const response = await withTimeout(
                      ai.models.generateContent({
                        model,
                        contents: { parts: audioParts },
                        ...(config ? { config } : {}),
                      }),
                      MODEL_ATTEMPT_TIMEOUT_MS,
                    );
                    modelCooldowns.clearModel(model);
                    return sanitizeTranscript(response.text ?? "");
                  } catch (err) {
                    lastErr = err;
                    const status = extractApiErrorStatus(err);
                    if (status === 429) {
                      retryAfterSeconds = modelCooldowns.markQuotaExceeded(model, err);
                    } else if (status === 404) {
                      modelCooldowns.markModelUnsupported(model);
                    } else if (err instanceof UpstreamTimeoutError || (status !== undefined && status >= 500)) {
                      modelCooldowns.markTransientFailure(model);
                    }
                    if (!shouldFallbackToNextModel(status)) {
                      throw err;
                    }
                    console.info(
                      `[transcribe] switching from ${model} (status=${status ?? "timeout"}) to fallback model`,
                    );
                  }
                }
                throw lastErr;
              });

              return Response.json({ text: transcript });
            } catch (err) {
              if (err instanceof QueueOverloadedError) {
                return Response.json(
                  {
                    error: {
                      code: "QUOTA_EXCEEDED",
                      retryAfterSeconds: 15,
                      message: "الضغط مرتفع حالياً على الخادم، سيتم التحويل للتسجيل المباشر أو أعد المحاولة بعد لحظات",
                    },
                  },
                  { status: 429, headers: { "Retry-After": "15" } },
                );
              }

              const status = extractApiErrorStatus(err);
              if (status === 400 || status === 401 || status === 403) {
                console.warn(`[transcribe] auth/config status=${status}`);
                return Response.json(
                  {
                    error: {
                      code: "INVALID_KEY",
                      message: "تحقّق من مفتاح خدمة التعرف على الصوت (GEMINI_API_KEY) في الإعدادات",
                    },
                  },
                  { status: status === 400 ? 403 : status },
                );
              }

              if (status === 429) {
                geminiExhausted = true;
                retryAfterSeconds = Math.max(retryAfterSeconds, modelCooldowns.getShortestCooldownRemainingSeconds());
                console.info("[transcribe] all Gemini models cooling down due to quota; checking fallback.");
              } else if (!lovableKey) {
                console.warn(`[transcribe] upstream unavailable (status=${status ?? "unknown"})`);
                return Response.json(
                  {
                    error: {
                      code: "UPSTREAM_UNAVAILABLE",
                      message: "تعذّر التعرف على الصوت مؤقتاً بسبب الضغط، حاول مرة أخرى أو استخدم الكتابة",
                    },
                  },
                  { status: err instanceof UpstreamTimeoutError ? 504 : 502 },
                );
              }
            }
          }
        }

        if (lovableKey) {
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
        }

        const waitSeconds = Math.max(30, retryAfterSeconds || 60);
        return Response.json(
          {
            error: {
              code: geminiExhausted ? "QUOTA_EXCEEDED" : "UPSTREAM_UNAVAILABLE",
              retryAfterSeconds: waitSeconds,
              message: "تم بلوغ الحد المؤقت لخدمة الصوت بسبب الضغط العالي؛ يمكنك المتابعة بالتسجيل المباشر أو الكتابة",
            },
          },
          {
            status: 429,
            headers: { "Retry-After": String(waitSeconds) },
          },
        );
      },
    },
  },
});
