import { createParser } from "eventsource-parser";
import { getSessionBearerToken } from "@/lib/api-client";
import { collapseRepeatedPhrases, restoreArabicHamzaAndMadda } from "@/lib/arabic";

let configuredCache: boolean | null = null;
let configuredInFlight: Promise<boolean> | null = null;
let serverCooldownUntilMs = 0;

export class TranscribeError extends Error {
  status: number;
  code: string;
  retryAfterSeconds: number;

  constructor(message: string, opts: { status?: number; code?: string; retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = "TranscribeError";
    this.status = opts.status ?? 0;
    this.code = opts.code ?? "UNKNOWN";
    this.retryAfterSeconds = opts.retryAfterSeconds ?? 0;
  }
}

export function resetTranscriptionConfigCache() {
  configuredCache = null;
  serverCooldownUntilMs = 0;
}

export function markServerTranscriptionCoolingDown(seconds: number): void {
  const clampedSec = Math.min(Math.max(Math.round(seconds || 120), 30), 600);
  serverCooldownUntilMs = Math.max(serverCooldownUntilMs, Date.now() + clampedSec * 1000);
}

export function isServerTranscriptionCoolingDown(): boolean {
  if (serverCooldownUntilMs <= Date.now()) {
    serverCooldownUntilMs = 0;
    return false;
  }
  return true;
}

export async function isServerTranscriptionConfigured(): Promise<boolean> {
  if (configuredCache !== null) return configuredCache;
  if (!configuredInFlight) {
    configuredInFlight = fetch("/api/transcribe", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return false;
        const data = (await res.json()) as {
          configured?: boolean;
          availableNow?: boolean;
          retryAfterSeconds?: number;
        };
        const ok = Boolean(data.configured);
        configuredCache = ok;
        if (ok && data.availableNow === false && data.retryAfterSeconds) {
          markServerTranscriptionCoolingDown(data.retryAfterSeconds);
        }
        return ok;
      })
      .catch(() => false)
      .finally(() => {
        configuredInFlight = null;
      });
  }
  return configuredInFlight;
}

/** Upload a recorded clip and return the cleaned Arabic name with hamzas & maddas. */
export async function transcribeAudio(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file, file.name);
  const bearer = getSessionBearerToken();

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);

  let res: Response;
  try {
    res = await fetch("/api/transcribe", {
      method: "POST",
      body: form,
      credentials: "include",
      headers: {
        "X-Requested-With": "rijal-client",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new TranscribeError("استغرق التعرف على الصوت وقتاً طويلاً، حاول مرة أخرى أو استخدم التسجيل المباشر", {
        status: 504,
        code: "TIMEOUT",
      });
    }
    throw new TranscribeError("تعذّر الاتصال بخدمة التعرف على الصوت، تحقّق من الشبكة", {
      status: 0,
      code: "NETWORK_ERROR",
    });
  } finally {
    window.clearTimeout(timeout);
  }

  if (!res.ok || !res.body) {
    if (res.status === 402 || res.status === 403 || res.status === 503) {
      configuredCache = false;
    }
    let message = "تعذّر التعرف على الصوت، حاول مرة أخرى";
    let code = "UPSTREAM_ERROR";
    let retryAfterSeconds = Number(res.headers.get("retry-after") ?? "0") || 0;

    try {
      const body = (await res.json()) as {
        error?: { message?: string; code?: string; retryAfterSeconds?: number };
      };
      if (body?.error?.code) code = String(body.error.code);
      if (typeof body?.error?.retryAfterSeconds === "number") {
        retryAfterSeconds = body.error.retryAfterSeconds;
      }

      if (res.status === 401) {
        message = "انتهت الجلسة، سجّل الدخول من جديد";
        code = "UNAUTHORIZED";
      } else if (res.status === 402) {
        message = "انتهى رصيد خدمة التعرف على الصوت";
        code = "QUOTA_EXCEEDED";
      } else if (res.status === 429) {
        code = "QUOTA_EXCEEDED";
        markServerTranscriptionCoolingDown(retryAfterSeconds || 120);
        message =
          body?.error?.message ||
          "تم بلوغ الحد المؤقت لخدمة الصوت بسبب الضغط العالي؛ يمكنك المتابعة بالتسجيل المباشر أو الكتابة";
      } else if (body?.error?.message && res.status !== 400) {
        message = String(body.error.message);
      }
    } catch {
      if (res.status === 429) {
        code = "QUOTA_EXCEEDED";
        markServerTranscriptionCoolingDown(retryAfterSeconds || 120);
        message = "طلبات كثيرة، انتظر لحظة أو تابع بالتسجيل المباشر";
      }
    }

    if (res.status === 502 || res.status === 503 || res.status === 504) {
      markServerTranscriptionCoolingDown(30);
    }

    throw new TranscribeError(message, { status: res.status, code, retryAfterSeconds });
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await res.json()) as { text?: unknown; error?: { message?: string } };
    if (payload.error?.message) throw new TranscribeError(String(payload.error.message));
    return restoreArabicHamzaAndMadda(collapseRepeatedPhrases(String(payload.text ?? "")));
  }

  let text = "";
  let final: string | null = null;
  let streamError: string | null = null;
  const parser = createParser({
    onEvent(event) {
      if (!event.data || event.data === "[DONE]") return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "transcript.text.delta") text += payload.delta ?? "";
        else if (payload.type === "transcript.text.done") final = payload.text ?? text;
        else if (payload.type === "error" || payload.error) streamError = payload.error?.message ?? "error";
      } catch {
        /* ignore malformed */
      }
    },
  });

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.feed(value);
  }
  if (streamError) throw new TranscribeError("تعذّر التعرف على الصوت، حاول مرة أخرى");
  return restoreArabicHamzaAndMadda(collapseRepeatedPhrases(final ?? text));
}
