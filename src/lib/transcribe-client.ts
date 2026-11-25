import { createParser } from "eventsource-parser";
import { getSessionBearerToken } from "@/lib/api-client";
import { collapseRepeatedPhrases, restoreArabicHamzaAndMadda } from "@/lib/arabic";

let configuredCache: boolean | null = null;
let configuredInFlight: Promise<boolean> | null = null;

export function resetTranscriptionConfigCache() {
  configuredCache = null;
}

export async function isServerTranscriptionConfigured(): Promise<boolean> {
  if (configuredCache !== null) return configuredCache;
  if (!configuredInFlight) {
    configuredInFlight = fetch("/api/transcribe", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) return false;
        const data = (await res.json()) as { configured?: boolean };
        const ok = Boolean(data.configured);
        configuredCache = ok;
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
  const timeout = window.setTimeout(() => controller.abort(), 25_000);

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
      throw new Error("استغرق التعرف على الصوت وقتاً طويلاً، حاول مرة أخرى");
    }
    throw new Error("تعذّر الاتصال بخدمة التعرف على الصوت، تحقّق من الشبكة");
  } finally {
    window.clearTimeout(timeout);
  }

  if (!res.ok || !res.body) {
    if (res.status === 402 || res.status === 403 || res.status === 503) {
      configuredCache = false;
    }
    let message = "تعذّر التعرف على الصوت، حاول مرة أخرى";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (res.status === 401) message = "انتهت الجلسة، سجّل الدخول من جديد";
      else if (res.status === 402) message = "انتهى رصيد خدمة التعرف على الصوت";
      else if (res.status === 429) message = "طلبات كثيرة، انتظر لحظة ثم أعد المحاولة";
      else if (body?.error?.message && res.status !== 400) message = String(body.error.message);
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await res.json()) as { text?: unknown; error?: { message?: string } };
    if (payload.error?.message) throw new Error(String(payload.error.message));
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
  if (streamError) throw new Error("تعذّر التعرف على الصوت، حاول مرة أخرى");
  return restoreArabicHamzaAndMadda(collapseRepeatedPhrases(final ?? text));
}
