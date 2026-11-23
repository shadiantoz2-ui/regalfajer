import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { Sunrise } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { VoiceNamePicker } from "@/components/VoiceNamePicker";
import { addStudent, dayAttendanceQuery, recordAttendance, studentsQuery } from "@/lib/data";
import { formatDateLong, localDateKey } from "@/lib/arabic";

export const Route = createFileRoute("/_authenticated/checkin")({
  head: () => ({
    meta: [
      { title: "تسجيل الحضور بالصوت — رجال الفجر" },
      { name: "description", content: "يقول الطالب اسمه وكنيته ليُسجَّل حضوره في رجال الفجر." },
      { property: "og:title", content: "تسجيل الحضور بالصوت — رجال الفجر" },
      { property: "og:description", content: "يقول الطالب اسمه وكنيته ليُسجَّل حضوره في رجال الفجر." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(dayAttendanceQuery(localDateKey()));
    return context.queryClient.ensureQueryData(studentsQuery());
  },
  component: CheckIn,
});

function useToday() {
  const [today, setToday] = useState(() => localDateKey());
  useEffect(() => {
    const t = window.setInterval(() => setToday(localDateKey()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return today;
}

function CheckIn() {
  const { role, userName } = Route.useRouteContext();
  const { data: students } = useSuspenseQuery(studentsQuery());
  const today = useToday();
  const qc = useQueryClient();

  return (
    <AppShell role={role} userName={userName}>
      <div className="mb-5 flex items-center justify-center gap-2 text-muted-foreground">
        <Sunrise className="size-5 text-dawn" />
        <span className="text-base">{formatDateLong(today)}</span>
      </div>

      <VoiceNamePicker
        students={students}
        onConfirm={(s) => recordAttendance(qc, s, localDateKey())}
        onRegister={async (name) => {
          const res = await addStudent(name);
          void qc.invalidateQueries({ queryKey: ["students"] });
          if (res.status === "invalid") throw new Error("invalid");
          return res;
        }}
        duplicateText={(n) => `${n} — تم تسجيل حضوره اليوم مسبقاً`}
      />

      <Suspense fallback={<div className="mt-8 h-32 animate-pulse rounded-[2rem] surface" />}>
        <TodayList date={today} />
      </Suspense>
    </AppShell>
  );
}

function TodayList({ date }: { date: string }) {
  const { data } = useSuspenseQuery(dayAttendanceQuery(date));
  return (
    <section className="mt-8 rounded-[2rem] p-6 surface">
      <div className="flex items-center justify-between">
        <h2 className="font-display flex items-center gap-2 text-xl text-foreground">
          حضور اليوم
          <span className="relative flex size-2.5" title="تحديث مباشر">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-success" />
          </span>
        </h2>
        <span className="rounded-full bg-gradient-gold px-4 py-1 text-lg font-bold text-primary-foreground">
          {data.length}
        </span>
      </div>
      {data.length === 0 ? (
        <p className="mt-4 text-center text-muted-foreground">لم يُسجَّل أحد بعد. كن أول رجال الفجر اليوم 🌅</p>
      ) : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {data.map((r, i) => (
            <li key={r.id} className="flex animate-rise items-center gap-3 rounded-2xl bg-secondary/50 px-4 py-3">
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
