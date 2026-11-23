import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Suspense, useEffect, useState } from "react";
import { Sunrise } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { VoiceNamePicker } from "@/components/VoiceNamePicker";
import { addStudent, dayAttendanceQuery, recordAttendance, studentsQuery } from "@/lib/attendance.functions";
import { formatDateLong, localDateKey } from "@/lib/arabic";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "رجال الفجر — تسجيل الحضور بالصوت" },
      { name: "description", content: "قل اسمك الثلاثي ليُسجَّل حضورك في رجال الفجر." },
      { property: "og:title", content: "رجال الفجر — تسجيل الحضور بالصوت" },
      { property: "og:description", content: "قل اسمك الثلاثي ليُسجَّل حضورك في رجال الفجر." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(studentsQuery()),
  component: CheckIn,
});

function useToday() {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setToday(localDateKey());
    update();
    const t = window.setInterval(update, 60_000);
    return () => window.clearInterval(t);
  }, []);
  return today;
}

function CheckIn() {
  const { data: students } = useSuspenseQuery(studentsQuery());
  const today = useToday();
  const qc = useQueryClient();
  const record = useServerFn(recordAttendance);
  const add = useServerFn(addStudent);

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-center gap-2 text-muted-foreground">
        <Sunrise className="size-5 text-dawn" />
        <span className="text-base">{today ? formatDateLong(today) : "\u00a0"}</span>
      </div>

      <VoiceNamePicker
        students={students}
        onConfirm={async (s) => {
          const date = localDateKey();
          const res = await record({ data: { student_id: s.id, date } });
          void qc.invalidateQueries({ queryKey: ["attendance", date] });
          return res.status === "duplicate" ? "duplicate" : "recorded";
        }}
        onRegister={async (name) => {
          const res = await add({ data: { full_name: name } });
          void qc.invalidateQueries({ queryKey: ["students"] });
          if (res.status === "invalid") throw new Error("invalid");
          return res;
        }}
        duplicateText={(n) => `${n} — تم تسجيل حضورك اليوم مسبقاً`}
      />

      {today && (
        <Suspense fallback={<div className="mt-8 h-32 animate-pulse rounded-[2rem] surface" />}>
          <TodayList date={today} />
        </Suspense>
      )}
    </AppShell>
  );
}

function TodayList({ date }: { date: string }) {
  const { data } = useSuspenseQuery(dayAttendanceQuery(date));
  return (
    <section className="mt-8 rounded-[2rem] p-6 surface">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl text-foreground">حضور اليوم</h2>
        <span className="rounded-full bg-gradient-gold px-4 py-1 text-lg font-bold text-primary-foreground">
          {data.length}
        </span>
      </div>
      {data.length === 0 ? (
        <p className="mt-4 text-center text-muted-foreground">لم يُسجَّل أحد بعد. كن أول رجال الفجر اليوم 🌅</p>
      ) : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {data.map((r, i) => (
            <li key={r.id} className="flex items-center gap-3 rounded-2xl bg-secondary/50 px-4 py-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                {data.length - i}
              </span>
              <span className="truncate">{r.full_name}</span>
              <span className="ms-auto text-xs text-muted-foreground" dir="ltr">
                {new Date(r.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
