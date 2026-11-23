import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Check, Keyboard, Loader2, Mic, RotateCcw, Square, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cleanDisplayName, findNameMatches, type NameMatch } from "@/lib/arabic";
import { recordWav, type WavRecording } from "@/lib/record-wav";
import { transcribeAudio } from "@/lib/transcribe-client";
import type { Student } from "@/lib/types";

export type ConfirmResult = "recorded" | "duplicate";
export type RegisterResult = { status: "created"; student: Student } | { status: "duplicate"; student: Student | null };

type Phase =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "processing" }
  | { kind: "result"; heard: string; matches: NameMatch<Student>[] }
  | { kind: "saving"; name: string }
  | { kind: "done"; name: string }
  | { kind: "duplicate"; name: string; reason: "attendance" | "student" }
  | { kind: "error"; message: string };

const MAX_SECONDS = 8;

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
  prompt = "اضغط على الزر وقل اسمك الثلاثي",
  successText = (n) => `تم تسجيل حضور ${n}`,
  duplicateText = (n) => `${n} مسجّل حضوره مسبقاً`,
  autoReset = true,
}: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [newName, setNewName] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const recRef = useRef<WavRecording | null>(null);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearInterval(t));
    timers.current = [];
  };

  useEffect(
    () => () => {
      clearTimers();
      recRef.current?.cancel();
    },
    [],
  );

  useEffect(() => {
    if (!autoReset) return undefined;
    if (phase.kind === "done" || phase.kind === "duplicate") {
      const t = window.setTimeout(() => setPhase({ kind: "idle" }), phase.kind === "done" ? 3500 : 5000);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [phase, autoReset]);

  const resolve = (heard: string) => {
    const clean = cleanDisplayName(heard);
    if (!clean) {
      setPhase({ kind: "error", message: "لم نسمع اسماً واضحاً، حاول مرة أخرى" });
      return;
    }
    setNewName(clean);
    setPhase({ kind: "result", heard: clean, matches: findNameMatches(clean, students) });
  };

  const start = async () => {
    try {
      const rec = await recordWav();
      recRef.current = rec;
      setSeconds(0);
      setPhase({ kind: "recording" });
      const startedAt = Date.now();
      timers.current.push(
        window.setInterval(() => {
          const s = (Date.now() - startedAt) / 1000;
          setSeconds(s);
          setLevel(rec.level());
          if (s >= MAX_SECONDS) void stop();
        }, 120),
      );
    } catch {
      setPhase({ kind: "error", message: "لا يمكن الوصول إلى الميكروفون. اسمح للموقع باستخدامه ثم أعد المحاولة" });
    }
  };

  const stop = async () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    clearTimers();
    setPhase({ kind: "processing" });
    try {
      const file = await rec.stop();
      const text = await transcribeAudio(file);
      resolve(text);
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "حدث خطأ، حاول مرة أخرى" });
    }
  };

  const confirm = async (student: Student) => {
    setPhase({ kind: "saving", name: student.full_name });
    try {
      const res = await onConfirm(student);
      setPhase(res === "duplicate" ? { kind: "duplicate", name: student.full_name, reason: "attendance" } : { kind: "done", name: student.full_name });
    } catch {
      setPhase({ kind: "error", message: "تعذّر الحفظ، حاول مرة أخرى" });
    }
  };

  const register = async (e: FormEvent) => {
    e.preventDefault();
    const name = cleanDisplayName(newName);
    if (name.split(" ").length < 2) return;
    setPhase({ kind: "saving", name });
    try {
      const res = await onRegister(name);
      if (res.status === "duplicate") {
        if (res.student) await confirm(res.student);
        else setPhase({ kind: "duplicate", name, reason: "student" });
        return;
      }
      await confirm(res.student);
    } catch {
      setPhase({ kind: "error", message: "تعذّر تسجيل الطالب، حاول مرة أخرى" });
    }
  };

  const submitTyped = (e: FormEvent) => {
    e.preventDefault();
    if (typed.trim()) {
      resolve(typed);
      setTyped("");
      setTyping(false);
    }
  };

  const reset = () => setPhase({ kind: "idle" });

  return (
    <div className="rounded-[2rem] p-6 surface md:p-10">
      {(phase.kind === "idle" || phase.kind === "recording" || phase.kind === "processing") && (
        <div className="flex flex-col items-center text-center">
          <p className="text-lg text-muted-foreground">
            {phase.kind === "recording"
              ? "نستمع إليك… قل اسمك ثم اضغط للإيقاف"
              : phase.kind === "processing"
                ? "جارِ التعرف على الاسم…"
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
              style={phase.kind === "recording" ? { transform: `scale(${1 + Math.min(level * 3, 0.12)})` } : undefined}
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
            <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-gradient-gold transition-[width] duration-100"
                style={{ width: `${Math.min(100, (seconds / MAX_SECONDS) * 100)}%` }}
              />
            </div>
          )}

          {phase.kind === "idle" &&
            (typing ? (
              <form onSubmit={submitTyped} className="flex w-full max-w-md gap-2">
                <Input
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="اكتب الاسم الثلاثي"
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
          <p className="text-sm text-muted-foreground">سمعنا:</p>
          <p className="mt-1 text-lg text-foreground/80">«{phase.heard}»</p>

          {phase.matches.length > 0 ? (
            <>
              <div className="mx-auto mt-6 max-w-md rounded-3xl border border-primary/40 bg-primary/10 p-6">
                <p className="text-sm text-muted-foreground">هل أنت</p>
                <p className="font-display mt-2 text-3xl text-gradient-gold md:text-4xl">
                  {phase.matches[0]?.item.full_name}
                </p>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:mx-auto sm:max-w-md">
                <Button variant="success" size="xl" onClick={() => phase.matches[0] && confirm(phase.matches[0].item)}>
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
            <form onSubmit={register} className="mx-auto mt-6 max-w-md">
              <div className="rounded-3xl border border-dawn/40 bg-dawn/10 p-5">
                <p className="font-semibold text-dawn">هذا الاسم غير موجود في قائمة الطلاب</p>
                <p className="mt-1 text-sm text-muted-foreground">تأكد من الاسم ثم سجّله كطالب جديد، أو أعد التلفظ</p>
              </div>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-4 h-12 rounded-xl bg-background/40 text-center text-lg"
                aria-label="الاسم الثلاثي للطالب الجديد"
              />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button type="submit" variant="gold" size="xl" disabled={cleanDisplayName(newName).split(" ").length < 2}>
                  <UserPlus className="size-5" /> تسجيل جديد
                </Button>
                <Button type="button" variant="glass" size="xl" onClick={reset}>
                  <RotateCcw className="size-5" /> إعادة
                </Button>
              </div>
            </form>
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
          <div className="grid size-28 place-items-center rounded-full bg-success text-success-foreground shadow-[0_0_60px_-10px_var(--success)]">
            <Check className="size-14" strokeWidth={3} />
          </div>
          <p className="font-display mt-6 text-3xl text-foreground">تم ✓</p>
          <p className="mt-2 text-lg text-muted-foreground">{successText(phase.name)}</p>
          <Button variant="glass" className="mt-6" onClick={reset}>
            التالي
          </Button>
        </div>
      )}

      {phase.kind === "duplicate" && (
        <div role="alert" className="animate-shake rounded-3xl border-2 border-destructive bg-destructive/15 p-8 text-center shadow-danger">
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
          <Button variant="gold" size="xl" className="mt-6" onClick={reset}>
            <RotateCcw className="size-5" /> حاول مرة أخرى
          </Button>
        </div>
      )}
    </div>
  );
}
