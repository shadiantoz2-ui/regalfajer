import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { CalendarDays, Download, FileSpreadsheet, History, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { VoiceNamePicker } from "@/components/VoiceNamePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addStudent,
  dayAttendanceQuery,
  deleteAttendance,
  fetchAllAttendance,
  recordAttendance,
  studentsQuery,
} from "@/lib/data";
import { formatDateLong, localDateKey } from "@/lib/arabic";

export const Route = createFileRoute("/_authenticated/records")({
  head: () => ({
    meta: [
      { title: "سجل الحضور والتحميل — رجال الفجر" },
      { name: "description", content: "تسجيل حضور بتاريخ سابق وتحميل بيانات حضور الطلاب في ملف Excel." },
      { property: "og:title", content: "سجل الحضور والتحميل — رجال الفجر" },
      { property: "og:description", content: "تسجيل حضور بتاريخ سابق وتحميل بيانات حضور الطلاب في ملف Excel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: ({ context }) => {
    if (context.role !== "admin") throw redirect({ to: "/checkin" });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(studentsQuery()),
  component: RecordsPage,
});

function DateField({ id, label, value, onChange, max }: { id: string; label: string; value: string; onChange: (v: string) => void; max?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="date"
        dir="ltr"
        lang="en"
        value={value}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 rounded-xl bg-background/40 text-center text-base"
      />
    </div>
  );
}

function RecordsPage() {
  const { role, userName } = Route.useRouteContext();
  const { data: students } = useSuspenseQuery(studentsQuery());
  const qc = useQueryClient();

  const [today, setToday] = useState("");
  const [pastDate, setPastDate] = useState("");
  const [viewDate, setViewDate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = localDateKey();
    const y = new Date();
    y.setDate(y.getDate() - 1);
    setToday(t);
    setPastDate(localDateKey(y));
    setViewDate(t);
  }, []);

  const download = async () => {
    setExporting(true);
    try {
      const [allStudents, attendance] = await Promise.all([
        qc.fetchQuery({ ...studentsQuery(), staleTime: 0 }),
        fetchAllAttendance(from || undefined, to || undefined),
      ]);
      const data = { students: allStudents, attendance };
      if (!data.students.length) {
        toast.error("لا يوجد طلاب لتحميل بياناتهم");
        return;
      }
      const { downloadAttendanceExcel } = await import("@/lib/export-excel");
      const label = from || to ? `${from || "البداية"}_${to || today}` : today;
      await downloadAttendanceExcel(data.students, data.attendance, label);
      toast.success("تم تحميل الملف");
    } catch {
      toast.error("تعذّر تحميل البيانات");
    } finally {
      setExporting(false);
    }
  };

  return (
    <AppShell compact role={role} userName={userName}>
      <section className="rounded-[2rem] p-6 surface">
        <h2 className="font-display flex items-center gap-2 text-2xl">
          <FileSpreadsheet className="size-6 text-primary" /> تحميل بيانات الحضور
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">ملف Excel فيه أسماء جميع الطلاب والأيام التي حضر بها كل طالب.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <DateField id="from" label="من (اختياري)" value={from} onChange={setFrom} max={today} />
          <DateField id="to" label="إلى (اختياري)" value={to} onChange={setTo} max={today} />
        </div>
        <Button variant="gold" size="xl" className="mt-4 w-full" onClick={download} disabled={exporting}>
          {exporting ? <Loader2 className="size-5 animate-spin" /> : <Download className="size-5" />}
          تحميل بيانات الحضور
        </Button>
      </section>

      <section className="mt-6">
        <div className="mb-4 rounded-[2rem] p-6 surface">
          <h2 className="font-display flex items-center gap-2 text-2xl">
            <History className="size-6 text-primary" /> تسجيل حضور بتاريخ سابق
          </h2>
          <div className="mt-4">
            <DateField id="past" label="تاريخ الحضور" value={pastDate} onChange={setPastDate} max={today} />
            {pastDate && <p className="mt-2 text-center text-sm text-primary">{formatDateLong(pastDate)}</p>}
          </div>
        </div>
        {pastDate && (
          <VoiceNamePicker
            key={pastDate}
            students={students}
            prompt="اضغط وقل اسم الطالب وكنيته"
            successText={(n) => `تم تسجيل حضور ${n} بتاريخ ${pastDate}`}
            duplicateText={(n) => `${n} مسجّل حضوره مسبقاً بتاريخ ${pastDate}`}
            onConfirm={(s) => recordAttendance(qc, s, pastDate)}
            onRegister={async (name) => {
              const res = await addStudent(name);
              void qc.invalidateQueries({ queryKey: ["students"] });
              if (res.status === "invalid") throw new Error("invalid");
              return res;
            }}
          />
        )}
      </section>

      <section className="mt-6 rounded-[2rem] p-6 surface">
        <h2 className="font-display flex items-center gap-2 text-2xl">
          <CalendarDays className="size-6 text-primary" /> حضور يوم محدد
        </h2>
        <div className="mt-4">
          <DateField id="view" label="اختر اليوم" value={viewDate} onChange={setViewDate} max={today} />
        </div>
        {viewDate && (
          <Suspense fallback={<div className="mt-4 h-24 animate-pulse rounded-2xl bg-secondary/40" />}>
            <DayList date={viewDate} />
          </Suspense>
        )}
      </section>
    </AppShell>
  );
}

function DayList({ date }: { date: string }) {
  const { data } = useSuspenseQuery(dayAttendanceQuery(date));
  const qc = useQueryClient();
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <p className="text-primary">{formatDateLong(date)}</p>
        <span className="rounded-full bg-gradient-gold px-3 py-0.5 font-bold text-primary-foreground">{data.length}</span>
      </div>
      {data.length === 0 ? (
        <p className="mt-4 text-center text-muted-foreground">لا يوجد حضور في هذا اليوم</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {data.map((r, i) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <span className="w-7 text-center text-sm text-muted-foreground">{i + 1}</span>
              <span className="flex-1">{r.full_name}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`إلغاء حضور ${r.full_name}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={async () => {
                  await deleteAttendance(r.id);
                  toast.success("تم إلغاء الحضور");
                  void qc.invalidateQueries({ queryKey: ["attendance", date] });
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
