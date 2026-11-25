import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { CalendarDays, Download, ExternalLink, Eye, EyeOff, Loader2, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDateLong, localDateKey } from "@/lib/arabic";
import { settingsQuery, setResultsPublic } from "@/lib/data";
import { createTeacher, deleteTeacher, getTeacherDayRecordings, listAdmins, listTeachers, type Teacher } from "@/lib/staff.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "الإدارة — رجال الفجر" },
      { name: "description", content: "إدارة حسابات المعلمين وإظهار النتائج للعامة." },
      { property: "og:title", content: "الإدارة — رجال الفجر" },
      { property: "og:description", content: "إدارة حسابات المعلمين وإظهار النتائج للعامة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: ({ context }) => {
    if (context.role !== "admin") throw redirect({ to: "/checkin" });
  },
  component: AdminPage,
});

function AdminPage() {
  const { role, userName } = Route.useRouteContext();
  const qc = useQueryClient();
  const list = useServerFn(listTeachers);
  const listAdminUsers = useServerFn(listAdmins);
  const fetchTeacherRecordings = useServerFn(getTeacherDayRecordings);
  const create = useServerFn(createTeacher);
  const remove = useServerFn(deleteTeacher);
  const settings = useQuery(settingsQuery());
  const teachers = useQuery({ queryKey: ["teachers"], queryFn: () => list() });
  const admins = useQuery({ queryKey: ["admins"], queryFn: () => listAdminUsers() });

  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [accountRole, setAccountRole] = useState<"teacher" | "admin">("teacher");
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState(false);

  const today = localDateKey();
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [teacherDate, setTeacherDate] = useState(today);
  const [downloadingTeacher, setDownloadingTeacher] = useState(false);

  const teacherRecordings = useQuery({
    queryKey: ["teacher-day-recordings", selectedTeacher?.id ?? "", teacherDate],
    queryFn: () =>
      fetchTeacherRecordings({
        data: { teacherId: selectedTeacher?.id ?? "", date: teacherDate },
      }),
    enabled: !!selectedTeacher && !!teacherDate,
  });

  const isPublic = settings.data?.results_public ?? false;

  const toggle = async (value: boolean) => {
    setToggling(true);
    try {
      await setResultsPublic(value);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["settings"] }),
        qc.invalidateQueries({ queryKey: ["public-results"] }),
      ]);
      toast.success(value ? "النتائج ظاهرة للعامة الآن" : "تم إغلاق عرض النتائج للعامة");
    } catch {
      toast.error("تعذّر التغيير");
    } finally {
      setToggling(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await create({ data: { name, login, password, role: accountRole } });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success(accountRole === "admin" ? "تم إنشاء حساب المدير" : "تم إنشاء حساب المعلم");
        setName("");
        setLogin("");
        setPassword("");
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["teachers"] }),
          qc.invalidateQueries({ queryKey: ["admins"] }),
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("غير مسموح") || /unauthorized/i.test(msg)) {
        toast.error("انتهت الجلسة أو الصلاحية — أعد تسجيل الدخول بحساب المدير");
      } else {
        toast.error("تأكد من البيانات: اسم الدخول بحروف إنجليزية وكلمة مرور 6 أحرف على الأقل");
      }
    } finally {
      setBusy(false);
    }
  };

  const downloadTeacherDay = async () => {
    const rows = teacherRecordings.data ?? [];
    if (!selectedTeacher || !rows.length) return;
    setDownloadingTeacher(true);
    try {
      const { downloadAttendanceExcel } = await import("@/lib/export-excel");
      const students = rows.map((r) => ({
        id: r.studentId,
        full_name: r.studentName,
        created_at: r.recordedAt,
      }));
      const attendance = rows.map((r) => ({
        id: r.id,
        student_id: r.studentId,
        attended_on: r.attendedOn,
        created_at: r.recordedAt,
      }));
      await downloadAttendanceExcel(students, attendance, `${selectedTeacher.login || selectedTeacher.name}-${teacherDate}`);
      toast.success("تم تنزيل قائمة المعلم لهذا اليوم");
    } catch {
      toast.error("تعذّر تنزيل الأسماء");
    } finally {
      setDownloadingTeacher(false);
    }
  };

  return (
    <AppShell compact role={role} userName={userName}>
      <section
        className={cn(
          "rounded-[2rem] border p-6 surface transition-colors",
          isPublic ? "border-success/40" : "border-primary/25",
        )}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div
              className={cn(
                "grid size-12 shrink-0 place-items-center rounded-2xl border",
                isPublic
                  ? "border-success/40 bg-success/15 text-success"
                  : "border-primary/30 bg-primary/10 text-primary",
              )}
            >
              {isPublic ? <Eye className="size-6" /> : <EyeOff className="size-6" />}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl">عرض النتائج للعامة</h2>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-0.5 text-xs font-semibold",
                    isPublic ? "bg-success/15 text-success" : "bg-primary/15 text-primary",
                  )}
                >
                  <span className={cn("size-2 rounded-full", isPublic ? "bg-success" : "bg-primary")} />
                  {isPublic ? "مفتوحة للجمهور" : "مغلقة حالياً"}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {isPublic
                  ? "لوحة النتائج ظاهرة الآن لجميع الطلاب والزوار في الصفحة الرئيسية"
                  : "تظهر للزوار شاشة إغلاق لوحة الشرف لحين فتحها من هنا"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 self-end sm:self-center">
            <Switch
              checked={isPublic}
              disabled={settings.isLoading || toggling}
              onCheckedChange={toggle}
              aria-label="عرض النتائج للعامة"
            />
            <Button
              type="button"
              variant={isPublic ? "glass" : "gold"}
              size="lg"
              disabled={settings.isLoading || toggling}
              onClick={() => void toggle(!isPublic)}
              className={cn(
                "min-w-[10.5rem] rounded-xl font-semibold",
                isPublic && "border-destructive/40 text-destructive hover:bg-destructive/15",
              )}
            >
              {toggling ? (
                <Loader2 className="size-4 animate-spin" />
              ) : isPublic ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
              {isPublic ? "إغلاق العرض" : "فتح العرض للعامة"}
            </Button>
          </div>
        </div>
        <div className="mt-4 flex justify-end border-t border-border/60 pt-3">
          <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
            <ExternalLink className="size-3.5" /> معاينة صفحة النتائج الخارجية
          </Link>
        </div>
      </section>

      <section className="mt-6 rounded-[2rem] p-6 surface">
        <h2 className="font-display flex items-center gap-2 text-2xl">
          <UserPlus className="size-6 text-primary" /> إضافة معلم أو مدير
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-background/40 p-1">
          <button
            type="button"
            onClick={() => setAccountRole("teacher")}
            className={cn(
              "cursor-pointer rounded-xl py-2 text-sm font-medium transition-colors",
              accountRole === "teacher" ? "bg-gradient-gold text-primary-foreground shadow-gold" : "text-muted-foreground hover:text-foreground",
            )}
          >
            معلم
          </button>
          <button
            type="button"
            onClick={() => setAccountRole("admin")}
            className={cn(
              "cursor-pointer rounded-xl py-2 text-sm font-medium transition-colors",
              accountRole === "admin" ? "bg-gradient-gold text-primary-foreground shadow-gold" : "text-muted-foreground hover:text-foreground",
            )}
          >
            مدير
          </button>
        </div>
        <form onSubmit={submit} className="mt-4 grid gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={accountRole === "admin" ? "اسم المدير" : "اسم المعلم"}
            className="h-12 rounded-xl bg-background/40"
            required
          />
          <Input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="اسم الدخول (بالإنجليزية) أو البريد" dir="ltr" className="h-12 rounded-xl bg-background/40" required />
          <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة المرور (6 أحرف على الأقل)" dir="ltr" className="h-12 rounded-xl bg-background/40" required />
          <Button type="submit" variant="gold" size="xl" disabled={busy}>
            {accountRole === "admin" ? "إنشاء حساب مدير" : "إنشاء حساب معلم"}
          </Button>
        </form>
      </section>

      <section className="mt-6 rounded-[2rem] p-6 surface">
        <h2 className="font-display flex items-center gap-2 text-2xl">
          <ShieldCheck className="size-6 text-primary" /> حسابات المعلمين
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">اضغط على حساب المعلم لاختيار يوم وعرض الطلاب الذين سجلهم فيه</p>
        {teachers.isLoading ? (
          <div className="mt-4 h-16 animate-pulse rounded-2xl bg-secondary/40" />
        ) : teachers.isError ? (
          <p role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {teachers.error instanceof Error ? teachers.error.message : "تعذّر تحميل الحسابات"}
          </p>
        ) : !teachers.data?.length ? (
          <p className="mt-4 text-center text-muted-foreground">لا يوجد معلمون بعد</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {teachers.data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTeacher(t);
                    setTeacherDate(today);
                  }}
                  className="flex flex-1 cursor-pointer items-center gap-3 text-right transition-colors hover:text-primary"
                >
                  <span className="flex-1 font-medium underline-offset-4 hover:underline">{t.name || t.login}</span>
                  <span className="text-sm text-muted-foreground" dir="ltr">
                    {t.login}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-primary">
                    <CalendarDays className="size-3.5" />
                    عرض السجل
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`حذف ${t.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    if (!window.confirm(`حذف حساب ${t.name}؟`)) return;
                    try {
                      await remove({ data: { id: t.id } });
                      toast.success("تم حذف الحساب");
                      await qc.invalidateQueries({ queryKey: ["teachers"] });
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "تعذّر حذف الحساب");
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!!admins.data?.length && (
        <section className="mt-6 rounded-[2rem] p-6 surface">
          <h2 className="font-display flex items-center gap-2 text-2xl">
            <ShieldCheck className="size-6 text-primary" /> المديرون
          </h2>
          <ul className="mt-4 divide-y divide-border">
            {admins.data.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-3">
                <span className="flex-1">{a.name || a.login}</span>
                <span className="text-sm text-muted-foreground" dir="ltr">{a.login}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog open={!!selectedTeacher} onOpenChange={(open) => !open && setSelectedTeacher(null)}>
        <DialogContent dir="rtl" className="max-h-[85dvh] overflow-y-auto rounded-[2rem] border-border surface">
          <DialogHeader className="pe-8 text-right sm:text-right">
            <DialogTitle className="font-display text-2xl text-gradient-gold">
              {selectedTeacher?.name || selectedTeacher?.login}
            </DialogTitle>
            <DialogDescription>
              اختر اليوم لعرض أسماء الطلاب الذين سجّلهم هذا المعلم بحسابه
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="teacher-day-picker" className="text-muted-foreground">
                اختر اليوم
              </Label>
              <Input
                id="teacher-day-picker"
                type="date"
                dir="ltr"
                lang="en"
                max={today}
                value={teacherDate}
                onChange={(e) => setTeacherDate(e.target.value)}
                className="h-12 rounded-xl bg-background/40 text-center text-base"
              />
              {teacherDate && <p className="text-center text-xs text-primary">{formatDateLong(teacherDate)}</p>}
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3">
              <span className="text-sm font-medium text-foreground">عدد الطلاب المسجَّلين</span>
              <span className="rounded-full bg-gradient-gold px-4 py-1 text-lg font-bold text-primary-foreground">
                {teacherRecordings.isLoading ? "..." : `${teacherRecordings.data?.length ?? 0} طالب`}
              </span>
            </div>

            {teacherRecordings.isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="size-6 animate-spin text-primary" />
              </div>
            ) : teacherRecordings.isError ? (
              <p className="py-4 text-center text-sm text-destructive">تعذّر تحميل سجل المعلم</p>
            ) : !teacherRecordings.data?.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">لم يقم هذا المعلم بتسجيل أي طالب في هذا اليوم</p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-2xl border border-border bg-background/30 px-4">
                {teacherRecordings.data.map((row, idx) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="w-6 text-xs text-muted-foreground">{idx + 1}</span>
                      <span className="font-medium">{row.studentName}</span>
                    </span>
                    <span className="text-xs text-muted-foreground" dir="ltr">
                      {new Date(row.recordedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              type="button"
              variant="gold"
              disabled={!teacherRecordings.data?.length || downloadingTeacher}
              onClick={downloadTeacherDay}
            >
              {downloadingTeacher ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              تنزيل الأسماء
            </Button>
            <Button type="button" variant="glass" onClick={() => setSelectedTeacher(null)}>
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
