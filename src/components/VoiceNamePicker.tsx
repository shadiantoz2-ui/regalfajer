import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  Check,
  Keyboard,
  Loader2,
  Mic,
  Pencil,
  RefreshCw,
  RotateCcw,
  Square,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cleanDisplayName,
  collapseRepeatedPhrases,
  findNameMatches,
  mergeSpeechSegments,
  normalizeName,
  restoreArabicHamzaAndMadda,
  type NameMatch,
} from "@/lib/arabic";
import { recordWav, type WavRecording } from "@/lib/record-wav";
import {
  isServerTranscriptionConfigured,
  isServerTranscriptionCoolingDown,
  transcribeAudio,
} from "@/lib/transcribe-client";
import type { Student } from "@/lib/types";

type BrowserSpeechAlternative = { transcript?: string; confidence?: number };
type BrowserSpeechResultItem = ArrayLike<BrowserSpeechAlternative> & { isFinal?: boolean };

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<BrowserSpeechResultItem> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserSpeechCtor = new () => BrowserSpeechRecognition;

function getSpeechRecognitionCtor(): BrowserSpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: BrowserSpeechCtor;
    webkitSpeechRecognition?: BrowserSpeechCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type ConfirmResult = "recorded" | "duplicate";
export type RegisterResult =
  | { status: "created"; student: Student }
  | { status: "duplicate"; student: Student | null };

type Phase =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "processing" }
  | { kind: "result"; heard: string; matches: NameMatch<Student>[] }
  | { kind: "saving"; name: string }
  | { kind: "done"; name: string }
  | { kind: "duplicate"; name: string; reason: "attendance" | "student" }
  | {
      kind: "error";
      message: string;
      canRetryAudio?: boolean;
      canFallbackBrowser?: boolean;
      canFallbackServer?: boolean;
    };

const MAX_SECONDS = 8;
const WAVE_WEIGHTS = [0.45, 0.72, 0.92, 1.0, 0.88, 0.68, 0.42];

type Props = {
  students: Student[];
  onConfirm: (student: Student) => Promise<ConfirmResult>;
  onRegister: (name: string) => Promise<RegisterResult>;
  prompt?: string;
  successText?: (name: string) => string;
  duplicateText?: (name: string) => string;
  autoReset?: boolean;
};

export function VoiceNamePicker({
  students,
  onConfirm,
  onRegister,
  prompt = "اضغط على الزر وقل اسمك وكنيتك",
  successText = (n) => `تم تسجيل حضور ${n}`,
  duplicateText = (n) => `${n} مسجّل حضوره مسبقاً`,
  autoReset = true,
}: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [newName, setNewName] = useState("");
  const [editingHeard, setEditingHeard] = useState(false);
  const [heardError, setHeardError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [liveHeard, setLiveHeard] = useState("");

  const recRef = useRef<WavRecording | null>(null);
  const lastAudioFileRef = useRef<File | null>(null);
  const speechRef = useRef<BrowserSpeechRecognition | null>(null);
  const speechTextRef = useRef("");
  const speechCandidatesRef = useRef<string[]>([]);
  const speechErrorRef = useRef("");
  const speechEndedRef = useRef(false);
  const serverConfiguredRef = useRef<boolean | null>(null);
  const inFlightSaveRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  const clearTimers = () => {
    timersRef.current.forEach((t) => window.clearInterval(t));
    timersRef.current = [];
  };

  useEffect(() => {
    if (!getSpeechRecognitionCtor()) {
      void isServerTranscriptionConfigured().then((ok) => {
        serverConfiguredRef.current = ok;
      });
    }
    return () => {
      clearTimers();
      recRef.current?.cancel();
      speechRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!autoReset) return undefined;
    if (phase.kind === "done" || phase.kind === "duplicate") {
      const t = window.setTimeout(
        () => setPhase({ kind: "idle" }),
        phase.kind === "done" ? 1600 : 4000,
      );
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [phase, autoReset]);

  const resolveCandidates = (candidates: readonly string[], fallback: string, preserveExactTyped = false) => {
    const formatCandidate = (raw: string) => {
      const collapsed = collapseRepeatedPhrases(raw);
      return preserveExactTyped ? collapsed : restoreArabicHamzaAndMadda(collapsed);
    };

    const primaryFallback = formatCandidate(fallback);
    const cleaned = Array.from(
      new Set([primaryFallback, ...candidates].map(formatCandidate).filter(Boolean)),
    );

    if (cleaned.length === 0) {
      setPhase({
        kind: "error",
        message: "لم نسمع اسماً واضحاً، قرّب الميكروفون وحاول مرة أخرى أو اكتب الاسم يدوياً",
      });
      return;
    }

    const fallbackMatches = primaryFallback ? findNameMatches(primaryFallback, students) : [];
    let bestHeard = primaryFallback || cleaned[0] || "";
    let bestMatches: NameMatch<Student>[] = fallbackMatches;

    for (const candidate of cleaned) {
      const matches = findNameMatches(candidate, students);
      const topScore = matches[0]?.score ?? 0;
      const bestTop = bestMatches[0]?.score ?? 0;
      if (topScore > bestTop) {
        bestMatches = matches;
        if (!primaryFallback || topScore >= 0.85 || candidate === primaryFallback) {
          bestHeard = candidate;
        }
      }
    }

    setNewName(bestHeard);
    setEditingHeard(false);
    setHeardError("");
    setPhase({ kind: "result", heard: bestHeard, matches: bestMatches });
  };

  const resolveVoice = (heard: string) => resolveCandidates([heard], heard, false);

  const transcribeClip = async (file: File) => {
    lastAudioFileRef.current = file;
    setPhase({ kind: "processing" });
    try {
      const rawTranscript = await transcribeAudio(file);
      const formatted = restoreArabicHamzaAndMadda(collapseRepeatedPhrases(rawTranscript));
      if (!formatted) {
        setPhase({
          kind: "error",
          message: "لم نسمع اسماً واضحاً، تكلّم بوضوح وحاول مرة أخرى",
          canRetryAudio: true,
        });
        return;
      }
      lastAudioFileRef.current = null;
      resolveVoice(formatted);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "تعذّر التعرف على الصوت، حاول مرة أخرى";
      const errStatus =
        typeof e === "object" && e !== null && "status" in e && typeof e.status === "number" ? e.status : 0;
      const errCode =
        typeof e === "object" && e !== null && "code" in e && typeof e.code === "string" ? e.code : "";
      const isConfigErr = msg.includes("غير مفعّلة") || msg.includes("مفتاح") || msg.includes("الجلسة");
      const isQuotaOrLoadErr =
        errStatus === 429 ||
        errStatus === 503 ||
        errStatus === 504 ||
        errCode === "QUOTA_EXCEEDED" ||
        msg.includes("الحد المؤقت") ||
        msg.includes("طلبات كثيرة") ||
        msg.includes("الضغط");
      const hasBrowserSpeech = Boolean(getSpeechRecognitionCtor());
      if (hasBrowserSpeech && isConfigErr) {
        serverConfiguredRef.current = false;
      }
      setPhase({
        kind: "error",
        message: msg,
        canRetryAudio: !isConfigErr,
        canFallbackBrowser: hasBrowserSpeech && (isQuotaOrLoadErr || isConfigErr || errStatus >= 500 || errStatus === 0),
      });
    }
  };

  const startSpeechRecognition = (lang: string, allowLangFallback: boolean): boolean => {
    const SpeechCtor = getSpeechRecognitionCtor();
    if (!SpeechCtor) return false;

    const rec = new SpeechCtor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 5;

    speechTextRef.current = "";
    speechCandidatesRef.current = [];
    speechErrorRef.current = "";
    speechEndedRef.current = false;
    setLiveHeard("");

    rec.onresult = (event) => {
      const finalSegments: string[] = [];
      let interimTail = "";
      const altSet = new Set<string>();

      for (let i = 0; i < event.results.length; i++) {
        const item = event.results[i];
        const primary = collapseRepeatedPhrases(item?.[0]?.transcript ?? "");
        if (!primary) continue;

        const priorPrefix = mergeSpeechSegments(finalSegments);
        if (item?.isFinal) {
          finalSegments.push(primary);
        } else {
          interimTail = primary;
        }

        for (let a = 0; a < item.length; a++) {
          const alt = collapseRepeatedPhrases(item[a]?.transcript ?? "");
          if (!alt) continue;
          const mergedAlt = priorPrefix ? mergeSpeechSegments([priorPrefix, alt]) : alt;
          if (mergedAlt) altSet.add(mergedAlt);
        }
      }

      const combined = restoreArabicHamzaAndMadda(
        mergeSpeechSegments(interimTail ? [...finalSegments, interimTail] : finalSegments),
      );

      if (combined) {
        speechTextRef.current = combined;
        speechCandidatesRef.current = Array.from(altSet, (c) => restoreArabicHamzaAndMadda(c));
        setLiveHeard(combined);
      }
    };

    rec.onerror = (event) => {
      const err = event.error ?? "unknown";
      speechErrorRef.current = err;
      if (err === "language-not-supported" && allowLangFallback && speechRef.current === rec) {
        speechRef.current = null;
        clearTimers();
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
        if (!startSpeechRecognition("ar", false)) {
          setPhase({
            kind: "error",
            message: "متصفحك لا يدعم التعرف على الصوت بالعربية، يمكنك كتابة الاسم يدوياً",
          });
        }
      }
    };

    rec.onend = () => {
      speechEndedRef.current = true;
      if (speechRef.current === rec) void stop();
    };

    speechRef.current = rec;
    setSeconds(0);
    setLevel(0.12);
    setPhase({ kind: "recording" });

    try {
      rec.start();
    } catch {
      speechRef.current = null;
      return false;
    }

    const startedAt = Date.now();
    timersRef.current.push(
      window.setInterval(() => {
        const s = (Date.now() - startedAt) / 1000;
        setSeconds(s);
        setLevel((prev) => (prev > 0.25 ? 0.16 : 0.34));
        if (s >= MAX_SECONDS) void stop();
      }, 120),
    );
    return true;
  };

  const startRecordingWav = async () => {
    lastAudioFileRef.current = null;
    try {
      const rec = await recordWav();
      recRef.current = rec;
      setLiveHeard("");
      setSeconds(0);
      setLevel(0.06);
      setPhase({ kind: "recording" });
      const startedAt = Date.now();
      timersRef.current.push(
        window.setInterval(() => {
          const s = (Date.now() - startedAt) / 1000;
          setSeconds(s);
          setLevel(rec.level());
          if (s >= MAX_SECONDS) void stop();
        }, 100),
      );
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : "";
      setPhase({
        kind: "error",
        message: msg.includes("المتصفح")
          ? msg
          : "لا يمكن الوصول إلى الميكروفون. اسمح للموقع باستخدامه ثم أعد المحاولة",
      });
    }
  };

  const start = async () => {
    setTyping(false);
    if (getSpeechRecognitionCtor() && startSpeechRecognition("ar-SA", true)) {
      return;
    }
    await startRecordingWav();
  };

  const stop = async () => {
    const speech = speechRef.current;
    if (speech) {
      speechRef.current = null;
      clearTimers();
      if (!speechEndedRef.current) {
        setPhase({ kind: "processing" });
        await new Promise<void>((done) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            done();
          };
          speech.onend = () => {
            speechEndedRef.current = true;
            finish();
          };
          try {
            speech.stop();
          } catch {
            finish();
          }
          window.setTimeout(finish, 1500);
        });
      }

      const heard = speechTextRef.current;
      const candidates = speechCandidatesRef.current;
      const err = speechErrorRef.current;
      setLiveHeard("");

      if (!heard && (err === "not-allowed" || err === "audio-capture")) {
        setPhase({
          kind: "error",
          message:
            err === "audio-capture"
              ? "لم يتم العثور على ميكروفون متاح على هذا الجهاز"
              : "لا يمكن الوصول إلى الميكروفون. اسمح للموقع باستخدامه ثم أعد المحاولة",
        });
        return;
      }
      if (!heard && err === "no-speech") {
        setPhase({
          kind: "error",
          message: "لم نسمع صوتاً، قرّب الميكروفون وحاول مرة أخرى أو اكتب الاسم",
        });
        return;
      }
      if (!heard && (err === "network" || err === "service-not-allowed" || err === "language-not-supported")) {
        const configured = serverConfiguredRef.current ?? (await isServerTranscriptionConfigured());
        serverConfiguredRef.current = configured;
        const coolingDown =
          typeof isServerTranscriptionCoolingDown === "function" ? isServerTranscriptionCoolingDown() : false;
        const canUseServer = configured && !coolingDown;
        setPhase({
          kind: "error",
          message: canUseServer
            ? "تعذّر التعرف المباشر من المتصفح، يمكنك استخدام التسجيل عبر الخادم أو كتابة الاسم يدوياً"
            : "متصفحك أو الشبكة لا تدعم التعرف الصوتي المباشر حالياً، يمكنك إعادة المحاولة أو كتابة الاسم يدوياً",
          canFallbackServer: canUseServer,
        });
        return;
      }
      resolveCandidates(candidates, heard, false);
      return;
    }

    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    clearTimers();
    setPhase({ kind: "processing" });

    let file: File;
    try {
      file = await rec.stop();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "حدث خطأ في التسجيل، حاول مرة أخرى";
      setPhase({ kind: "error", message: msg });
      return;
    }

    await transcribeClip(file);
  };

  const confirm = async (student: Student) => {
    if (inFlightSaveRef.current) return;
    inFlightSaveRef.current = true;
    setPhase({ kind: "saving", name: student.full_name });
    try {
      const res = await onConfirm(student);
      setPhase(
        res === "duplicate"
          ? { kind: "duplicate", name: student.full_name, reason: "attendance" }
          : { kind: "done", name: student.full_name },
      );
    } catch {
      setPhase({ kind: "error", message: "تعذّر الحفظ، حاول مرة أخرى" });
    } finally {
      inFlightSaveRef.current = false;
    }
  };

  const registerName = async (rawName: string) => {
    if (inFlightSaveRef.current) return;
    const name = cleanDisplayName(rawName);
    if (name.split(" ").length < 2) {
      setEditingHeard(true);
      setHeardError("اكتب الاسم والكنية على الأقل قبل الإضافة");
      return;
    }
    inFlightSaveRef.current = true;
    setHeardError("");
    setPhase({ kind: "saving", name });
    try {
      const res = await onRegister(name);
      if (res.status === "duplicate") {
        inFlightSaveRef.current = false;
        if (res.student) await confirm(res.student);
        else setPhase({ kind: "duplicate", name, reason: "student" });
        return;
      }
      inFlightSaveRef.current = false;
      await confirm(res.student);
    } catch {
      inFlightSaveRef.current = false;
      setPhase({ kind: "error", message: "تعذّر تسجيل الطالب، حاول مرة أخرى" });
    }
  };

  const register = async (e: FormEvent) => {
    e.preventDefault();
    await registerName(newName);
  };

  const submitTyped = (e: FormEvent) => {
    e.preventDefault();
    if (typed.trim()) {
      resolveCandidates([typed], typed, true);
      setTyped("");
      setTyping(false);
    }
  };

  const reset = () => {
    setEditingHeard(false);
    setHeardError("");
    setLiveHeard("");
    lastAudioFileRef.current = null;
    setPhase({ kind: "idle" });
  };

  return (
    <div className="rounded-[2rem] p-6 surface md:p-10">
      {(phase.kind === "idle" || phase.kind === "recording" || phase.kind === "processing") && (
        <div className="flex flex-col items-center text-center">
          <p className="text-lg text-muted-foreground">
            {phase.kind === "recording"
              ? "نستمع إليك… قل الاسم بوضوح ثم اضغط للإيقاف"
              : phase.kind === "processing"
                ? "جارِ تحليل الصوت وضبط الاسم والهمزات…"
                : prompt}
          </p>

          <div className="relative my-10 grid place-items-center">
            {phase.kind === "recording" && (
              <>
                <span className="absolute size-40 rounded-full bg-primary/30 animate-pulse-ring" />
                <span className="absolute size-40 rounded-full bg-primary/20 animate-pulse-ring [animation-delay:0.6s]" />
              </>
            )}
            <button
              type="button"
              onClick={phase.kind === "recording" ? stop : start}
              disabled={phase.kind === "processing"}
              aria-label={phase.kind === "recording" ? "إيقاف التسجيل" : "ابدأ التسجيل"}
              className="relative grid size-40 cursor-pointer place-items-center rounded-full bg-gradient-gold text-primary-foreground shadow-gold transition-transform hover:scale-105 active:scale-95 disabled:cursor-wait disabled:opacity-80"
              style={
                phase.kind === "recording"
                  ? { transform: `scale(${1 + Math.min(level * 3, 0.12)})` }
                  : undefined
              }
            >
              {phase.kind === "processing" ? (
                <Loader2 className="size-14 animate-spin" />
              ) : phase.kind === "recording" ? (
                <Square className="size-12 fill-current" />
              ) : (
                <Mic className="size-16" strokeWidth={1.8} />
              )}
            </button>
          </div>

          {phase.kind === "recording" && (
            <div className="flex w-full max-w-xs flex-col items-center gap-3">
              <div className="flex h-8 items-center justify-center gap-1.5" aria-hidden="true">
                {WAVE_WEIGHTS.map((w, idx) => {
                  const pct = Math.min(100, Math.max(18, Math.round((level * 320 + 18) * w)));
                  return (
                    <span
                      key={idx}
                      className="w-1.5 rounded-full bg-primary transition-[height] duration-75"
                      style={{ height: `${pct}%` }}
                    />
                  );
                })}
              </div>

              <div className="flex w-full items-center gap-2.5">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-gradient-gold transition-[width] duration-100"
                    style={{ width: `${Math.min(100, (seconds / MAX_SECONDS) * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-muted-foreground tabular-nums" dir="ltr">
                  {Math.min(MAX_SECONDS, Math.ceil(seconds))}s / {MAX_SECONDS}s
                </span>
              </div>

              {liveHeard && <p className="text-sm text-primary">«{liveHeard}»</p>}
            </div>
          )}

          {phase.kind === "idle" &&
            (typing ? (
              <form onSubmit={submitTyped} className="flex w-full max-w-md gap-2">
                <Input
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="الاسم والكنية"
                  className="h-12 rounded-xl bg-background/40 text-base"
                />
                <Button type="submit" variant="gold" className="h-12 rounded-xl px-6">
                  بحث
                </Button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setTyping(true)}
                className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
              >
                <Keyboard className="size-4" /> أو اكتب الاسم بدلاً من ذلك
              </button>
            ))}
        </div>
      )}

      {phase.kind === "result" && (
        <div className="animate-rise text-center">
          {phase.matches.length > 0 ? (
            <>
              <div className="mx-auto inline-flex max-w-lg flex-wrap items-center justify-center gap-2 rounded-2xl border border-border/70 bg-background/35 px-3.5 py-2">
                <span className="text-sm text-muted-foreground">سمعنا:</span>
                <span className="text-base font-semibold text-foreground">«{phase.heard}»</span>
                {normalizeName(phase.heard) !== normalizeName(phase.matches[0]?.item.full_name ?? "") && (
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="gold"
                      size="sm"
                      className="h-7 rounded-lg px-2.5 text-xs"
                      onClick={() => void registerName(phase.heard)}
                    >
                      <UserPlus className="size-3.5" /> إضافة
                    </Button>
                    <Button
                      type="button"
                      variant="glass"
                      size="sm"
                      className="h-7 rounded-lg px-2.5 text-xs"
                      onClick={() => {
                        setNewName(phase.heard);
                        setHeardError("");
                        setEditingHeard((v) => !v);
                      }}
                    >
                      <Pencil className="size-3.5" /> تعديل
                    </Button>
                  </div>
                )}
              </div>

              {editingHeard && (
                <form
                  onSubmit={register}
                  className="mx-auto mt-4 max-w-md animate-rise rounded-2xl border border-primary/30 bg-background/40 p-4"
                >
                  <p className="mb-2 text-xs text-muted-foreground">تعديل الاسم المسموع قبل إضافته وتسجيل حضوره:</p>
                  <Input
                    autoFocus
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      setHeardError("");
                    }}
                    placeholder="اكتب الاسم والكنية"
                    className="h-11 rounded-xl bg-background/50 text-center text-base"
                    aria-label="تعديل اسم الطالب قبل الإضافة"
                  />
                  {heardError && <p className="mt-2 text-xs text-destructive">{heardError}</p>}
                  <div className="mt-3 grid grid-cols-2 gap-2.5">
                    <Button
                      type="submit"
                      variant="gold"
                      size="lg"
                      disabled={cleanDisplayName(newName).split(" ").length < 2}
                    >
                      <UserPlus className="size-4" /> حفظ وإضافة
                    </Button>
                    <Button type="button" variant="glass" size="lg" onClick={() => setEditingHeard(false)}>
                      إلغاء
                    </Button>
                  </div>
                </form>
              )}

              <div className="mx-auto mt-6 max-w-md rounded-3xl border border-primary/40 bg-primary/10 p-6">
                <p className="text-sm text-muted-foreground">هل أنت</p>
                <p className="font-display mt-2 text-3xl text-gradient-gold md:text-4xl">
                  {phase.matches[0]?.item.full_name}
                </p>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:mx-auto sm:max-w-md">
                <Button
                  variant="success"
                  size="xl"
                  onClick={() => phase.matches[0] && confirm(phase.matches[0].item)}
                >
                  <Check className="size-5" /> تم
                </Button>
                <Button variant="glass" size="xl" onClick={reset}>
                  <RotateCcw className="size-5" /> إعادة
                </Button>
              </div>
              {phase.matches.length > 1 && (
                <div className="mt-8">
                  <p className="text-sm text-muted-foreground">أو هل تقصد:</p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {phase.matches.slice(1).map((m) => (
                      <button
                        key={m.item.id}
                        type="button"
                        onClick={() => confirm(m.item)}
                        className="cursor-pointer rounded-full border border-border bg-secondary/60 px-4 py-2 text-sm transition-colors hover:border-primary hover:text-primary"
                      >
                        {m.item.full_name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="mx-auto mt-2 max-w-lg">
              <div className="rounded-3xl border border-dawn/40 bg-dawn/10 p-5">
                <p className="font-semibold text-dawn">هذا الاسم غير موجود في قائمة الطلاب</p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-background/35 px-3 py-2.5">
                  <span className="text-sm text-muted-foreground">سمعنا:</span>
                  <span className="text-base font-semibold text-foreground">«{phase.heard}»</span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="gold"
                      size="sm"
                      className="h-8 rounded-xl px-3 text-xs"
                      onClick={() => void registerName(phase.heard)}
                    >
                      <UserPlus className="size-3.5" /> إضافة
                    </Button>
                    <Button
                      type="button"
                      variant="glass"
                      size="sm"
                      className="h-8 rounded-xl px-3 text-xs"
                      onClick={() => {
                        setNewName(phase.heard);
                        setHeardError("");
                        setEditingHeard((v) => !v);
                      }}
                    >
                      <Pencil className="size-3.5" /> تعديل
                    </Button>
                  </div>
                </div>
              </div>

              {editingHeard && (
                <form onSubmit={register} className="mt-4 animate-rise">
                  <Input
                    autoFocus
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      setHeardError("");
                    }}
                    placeholder="اكتب الاسم والكنية"
                    className="h-12 rounded-xl bg-background/40 text-center text-lg"
                    aria-label="تعديل اسم الطالب قبل الإضافة"
                  />
                  {heardError && <p className="mt-2 text-xs text-destructive">{heardError}</p>}
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Button
                      type="submit"
                      variant="gold"
                      size="xl"
                      disabled={cleanDisplayName(newName).split(" ").length < 2}
                    >
                      <UserPlus className="size-5" /> حفظ وإضافة
                    </Button>
                    <Button type="button" variant="glass" size="xl" onClick={reset}>
                      <RotateCcw className="size-5" /> إعادة
                    </Button>
                  </div>
                </form>
              )}

              {!editingHeard && (
                <div className="mt-4">
                  <Button type="button" variant="glass" size="xl" className="w-full" onClick={reset}>
                    <RotateCcw className="size-5" /> إعادة
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {phase.kind === "saving" && (
        <div className="flex flex-col items-center py-14 text-center">
          <Loader2 className="size-12 animate-spin text-primary" />
          <p className="mt-4 text-muted-foreground">جارِ الحفظ…</p>
        </div>
      )}

      {phase.kind === "done" && (
        <div className="flex animate-rise flex-col items-center py-8 text-center">
          <button
            type="button"
            onClick={reset}
            aria-label="التالي"
            title="اضغط للمتابعة"
            className="grid size-28 cursor-pointer place-items-center rounded-full bg-success text-success-foreground shadow-[0_0_60px_-10px_var(--success)] transition-transform hover:scale-105 active:scale-95"
          >
            <Check className="size-14" strokeWidth={3} />
          </button>
          <p className="font-display mt-6 text-3xl text-foreground">تم ✓</p>
          <p className="mt-2 text-lg text-muted-foreground">{successText(phase.name)}</p>
        </div>
      )}

      {phase.kind === "duplicate" && (
        <div
          role="alert"
          className="animate-shake rounded-3xl border-2 border-destructive bg-destructive/15 p-8 text-center shadow-danger"
        >
          <div className="mx-auto grid size-20 place-items-center rounded-full bg-destructive text-destructive-foreground">
            <AlertTriangle className="size-10" />
          </div>
          <p className="font-display mt-5 text-2xl text-destructive">تنبيه: اسم مكرر</p>
          <p className="mt-2 text-lg text-foreground">
            {phase.reason === "attendance" ? duplicateText(phase.name) : `${phase.name} موجود مسبقاً`}
          </p>
          <Button variant="destructive" className="mt-6" onClick={reset}>
            حسناً
          </Button>
        </div>
      )}

      {phase.kind === "error" && (
        <div className="flex animate-rise flex-col items-center py-8 text-center">
          <AlertTriangle className="size-12 text-dawn" />
          <p className="mt-4 text-lg">{phase.message}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {phase.canFallbackBrowser && (
              <Button
                variant="gold"
                size="xl"
                onClick={() => {
                  lastAudioFileRef.current = null;
                  if (!startSpeechRecognition("ar-SA", true)) {
                    reset();
                  }
                }}
              >
                <Mic className="size-5" /> التسجيل المباشر عبر المتصفح
              </Button>
            )}
            {phase.canFallbackServer && (
              <Button
                variant="gold"
                size="xl"
                onClick={() => {
                  lastAudioFileRef.current = null;
                  void startRecordingWav();
                }}
              >
                <Mic className="size-5" /> التسجيل عبر الخادم
              </Button>
            )}
            {phase.canRetryAudio && lastAudioFileRef.current && (
              <Button
                variant={phase.canFallbackBrowser ? "glass" : "gold"}
                size="xl"
                onClick={() => {
                  const file = lastAudioFileRef.current;
                  if (file) void transcribeClip(file);
                }}
              >
                <RefreshCw className="size-5" /> إعادة المحاولة بنفس التسجيل
              </Button>
            )}
            <Button
              variant={phase.canRetryAudio || phase.canFallbackBrowser || phase.canFallbackServer ? "glass" : "gold"}
              size="xl"
              onClick={reset}
            >
              <RotateCcw className="size-5" /> حاول مرة أخرى
            </Button>
            <Button
              variant="glass"
              size="xl"
              onClick={() => {
                setTyping(true);
                reset();
              }}
            >
              <Keyboard className="size-5" /> كتابة الاسم
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
