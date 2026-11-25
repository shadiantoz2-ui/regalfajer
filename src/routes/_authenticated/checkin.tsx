import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Suspense, useEffect, useState } from "react";
import { Download, Loader2, Sunrise } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { VoiceNamePicker } from "@/components/VoiceNamePicker";
import { Button } from "@/components/ui/button";
import { addStudent, dayAttendanceQuery, recordAttendance, studentsQuery } from "@/lib/data";
import { formatDateLong, localDateKey } from "@/lib/arabic";
import { getMyDayRecordings, recordStaffCheckin } from "@/lib/staff.functions";

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
    if (context.role === "admin") {
      void context.queryClient.prefetchQuery(dayAttendanceQuery(localDateKey()));
    }
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
  const logCheckin = useServerFn(recordStaffCheckin);

  const showWelcome = role === "teacher" || (role === "admin" && Boolean(userName));

  return (
    <AppShell role={role} userName={userName}>
      {showWelcome && (
        <div className="mb-5 rounded-3xl border border-primary/30 bg-primary/10 px-5 py-3.5 text-center surface">
          <p className="font-display text-xl text-gradient-gold md:text-2xl">
            {userName ? `أهلا وسهلا بالأستاذ ${userName}` : "أهلا وسهلا بالأستاذ"}
          </p>
        </div>
      )}
      <div className="mb-5 flex items-center justify-center gap-2 text-muted-foreground">
        <Sunrise className="size-5 text-dawn" />
        <span className="text-base">{formatDateLong(today)}</span>
      </div>

      <VoiceNamePicker
        students={students}
        onConfirm={async (s) => {
          const date = localDateKey();
          const res = await recordAttendance(qc, s, date);
          if (res === "recorded") {
            try {
              await logCheckin({ data: { studentId: s.id, studentName: s.full_name, attendedOn: date } });
              void qc.invalidateQueries({ queryKey: ["my-day-recordings", date] });
            } catch {
              /* attendance already persisted */
            }
          }
          return res;
        }}
        onRegister={async (name) => {
          const res = await addStudent(name);
          void qc.invalidateQueries({ queryKey: ["students"] });
          if (res.status === "invalid") throw new Error("invalid");
          return res;
        }}
        duplicateText={(n) => `${n} — تم تسجيل حضوره اليوم مسبقاً`}
      />

      {role === "admin" && (
        <Suspense fallback={<div className="mt-8 h-32 animate-pulse rounded-[2rem] surface" />}>
          <TodayList date={today} />
        </Suspense>
      )}

      {role === "teacher" && <TeacherTodayList date={today} />}
    </AppShell>
  );
}

function TeacherTodayList({ date }: { date: string }) {
  const fetchMine = useServerFn(getMyDayRecordings);
  const { data = [], isLoading } = useQuery({
    queryKey: ["my-day-recordings", date],
    queryFn: () => fetchMine({ data: { date } }),
    staleTime: 15_000,
  });
  const [downloading, setDownloading] = useState(false);

  const downloadMine = async () => {
    if (!data.length) return;
    setDownloading(true);
    try {
      const { downloadAttendanceExcel } = await import("@/lib/export-excel");
      const students = data.map((r) => ({
        id: r.studentId,
        full_name: r.studentName,
        created_at: r.recordedAt,
      }));
      const attendance = data.map((r) => ({
        id: r.id,
        student_id: r.studentId,
        attended_on: r.attendedOn,
        created_at: r.recordedAt,
      }));
      await downloadAttendanceExcel(students, attendance, `تسجيلاتي-${date}`);
      toast.success("تم تنزيل قائمة الطلاب الذين سجلتهم");
    } catch {
      toast.error("تعذّر تنزيل الأسماء");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="mt-8 rounded-[2rem] p-6 surface">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display flex items-center gap-2 text-xl text-foreground">
            حضور اليوم
            <span className="rounded-full bg-gradient-gold px-3.5 py-0.5 text-base font-bold text-primary-foreground">
              {data.length}
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">الطلاب الذين قمت بتسجيلهم بحسابك فقط</p>
        </div>

        <Button
          type="button"
          variant="gold"
          size="sm"
          className="rounded-xl px-4"
          disabled={isLoading || data.length === 0 || downloading}
          onClick={downloadMine}
        >
          {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          تنزيل الأسماء
        </Button>
      </div>

      {isLoading ? (
        <div className="mt-4 h-24 animate-pulse rounded-2xl bg-secondary/40" />
      ) : data.length === 0 ? (
        <p className="mt-4 text-center text-muted-foreground">لم تسجّل أي طالب بحسابك اليوم بعد</p>
      ) : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {data.map((r, i) => (
            <li key={r.id} className="flex animate-rise items-center gap-3 rounded-2xl bg-secondary/50 px-4 py-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                {data.length - i}
              </span>
              <span className="truncate">{r.studentName}</span>
              <span className="ms-auto text-xs text-muted-foreground" dir="ltr">
                {new Date(r.recordedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
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
