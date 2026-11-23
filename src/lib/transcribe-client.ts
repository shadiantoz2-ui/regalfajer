import { createParser } from "eventsource-parser";

/** Upload a recorded clip and read the streamed transcript to the end. */
export async function transcribeAudio(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok || !res.body) {
    let message = "تعذّر التعرف على الصوت، حاول مرة أخرى";
    try {
      const body = await res.json();
      if (res.status === 402) message = "انتهى رصيد خدمة التعرف على الصوت";
      else if (res.status === 429) message = "طلبات كثيرة، انتظر لحظة ثم أعد المحاولة";
      else if (body?.error?.message && res.status !== 400) message = String(body.error.message);
    } catch {
      /* keep default */
    }
    throw new Error(message);
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
  return (final ?? text).trim();
}
