import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, CalendarDays, ListPlus, Loader2, Pencil, Search, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  addStudent,
  deleteStudent,
  recordAttendance,
  recordAttendanceBulk,
  renameStudent,
  studentAttendanceQuery,
  studentsQuery,
} from "@/lib/data";
import { cleanDisplayName, formatDateLong, localDateKey, normalizeName, sameFirstAndFamily } from "@/lib/arabic";
import { recordStaffCheckin } from "@/lib/staff.functions";
import type { Student } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/students")({
  head: () => ({
    meta: [
      { title: "قائمة الطلاب — رجال الفجر" },
      { name: "description", content: "إدخال وإدارة أسماء طلاب رجال الفجر." },
      { property: "og:title", content: "قائمة الطلاب — رجال الفجر" },
      { property: "og:description", content: "إدخال وإدارة أسماء طلاب رجال الفجر." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) =>
    context.role === "admin" ? context.queryClient.ensureQueryData(studentsQuery()) : Promise.resolve([]),
  component: StudentsPage,
});

function StudentsPage() {
  const { role, userName } = Route.useRouteContext();
  const isAdmin = role === "admin";
  const studentsResult = useQuery({ ...studentsQuery(), enabled: isAdmin });
  const students = useMemo(() => studentsResult.data ?? [], [studentsResult.data]);
  const qc = useQueryClient();
  const logCheckin = useServerFn(recordStaffCheckin);

  const [name, setName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const [dupes, setDupes] = useState<string[]>([]);
  const [q, setQ] = useState("");

  const [pendingTodayAttendance, setPendingTodayAttendance] = useState<Student[]>([]);
  const [markingToday, setMarkingToday] = useState(false);

  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const today = localDateKey();

  const studentAttendance = useQuery({
    ...studentAttendanceQuery(selectedStudent?.id ?? ""),
    enabled: isAdmin && !!selectedStudent,
  });

  const exact = useMemo(() => new Map(students.map((s) => [normalizeName(s.full_name), s])), [students]);
  const typed = isAdmin && name.trim().length > 2 ? name : "";
  const exactDuplicate = typed ? exact.get(normalizeName(typed)) : undefined;
  const similar = typed && !exactDuplicate ? students.find((s) => sameFirstAndFamily(s.full_name, typed)) : undefined;

  const editDuplicate = useMemo(() => {
    if (!editingStudent) return undefined;
    const clean = cleanDisplayName(editName);
    if (clean.length <= 2) return undefined;
    const match = exact.get(normalizeName(clean));
    return match && match.id !== editingStudent.id ? match : undefined;
  }, [editName, editingStudent, exact]);

  const filtered = useMemo(() => {
    const n = normalizeName(q);
    return n ? students.filter((s) => normalizeName(s.full_name).includes(n)) : students;
  }, [q, students]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["students"] });

  const openEdit = (student: Student) => {
    setEditingStudent(student);
    setEditName(student.full_name);
    setEditError("");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = cleanDisplayName(name);
    if (clean.split(" ").length < 2) {
      toast.error("اكتب الاسم والكنية على الأقل");
      return;
    }
    setBusy(true);
    try {
      const res = await addStudent(clean);
      if (res.status === "duplicate") setDupes([clean]);
      else if (res.status === "created") {
        toast.success(`تمت إضافة ${res.student.full_name}`);
        setName("");
        setDupes([]);
        await refresh();
        setPendingTodayAttendance([res.student]);
      }
    } catch {
      toast.error("تعذّرت الإضافة، حاول مرة أخرى");
    } finally {
      setBusy(false);
    }
  };

  const submitBulk = async () => {
    const names = bulk
      .split(/\r?\n/)
      .map(cleanDisplayName)
      .filter((n) => n.split(" ").length >= 2);
    if (!names.length) return;
    setBusy(true);
    const created: Student[] = [];
    const duplicates: string[] = [];
    try {
      for (const n of names) {
        const res = await addStudent(n);
        if (res.status === "created") created.push(res.student);
        else if (res.status === "duplicate") duplicates.push(n);
      }
      setDupes(duplicates);
      if (created.length) {
        toast.success(`تمت إضافة ${created.length} طالب`);
        setPendingTodayAttendance(created);
      }
      setBulk("");
      setBulkOpen(false);
      await refresh();
    } catch {
      toast.error("تعذّرت الإضافة، حاول مرة أخرى");
    } finally {
      setBusy(false);
    }
  };

  const confirmTodayAttendance = async () => {
    if (!pendingTodayAttendance.length) return;
    setMarkingToday(true);
    try {
      if (pendingTodayAttendance.length === 1 && pendingTodayAttendance[0]) {
        const target = pendingTodayAttendance[0];
        const res = await recordAttendance(qc, target, today);
        if (res === "duplicate") toast.info(`${target.full_name} مسجّل حضوره اليوم مسبقاً`);
        else {
          toast.success(`تم تسجيل حضور ${target.full_name} لهذا اليوم`);
          try {
            await logCheckin({ data: { studentId: target.id, studentName: target.full_name, attendedOn: today } });
          } catch {
            /* attendance already persisted */
          }
        }
        void qc.invalidateQueries({ queryKey: ["student-attendance", target.id] });
      } else {
        const { recorded } = await recordAttendanceBulk(
          qc,
          pendingTodayAttendance.map((s) => s.id),
          today,
        );
        toast.success(`تم تسجيل حضور ${recorded} طالب لهذا اليوم`);
        for (const s of pendingTodayAttendance) {
          try {
            await logCheckin({ data: { studentId: s.id, studentName: s.full_name, attendedOn: today } });
          } catch {
            /* best-effort attribution */
          }
        }
        void qc.invalidateQueries({ queryKey: ["student-attendance"] });
      }
      await qc.invalidateQueries({ queryKey: ["attendance", today] });
      void qc.invalidateQueries({ queryKey: ["my-day-recordings", today] });
      void qc.invalidateQueries({ queryKey: ["public-results"] });
    } catch {
      toast.error("تعذّر تسجيل حضور اليوم");
    } finally {
      setMarkingToday(false);
      setPendingTodayAttendance([]);
    }
  };

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    const clean = cleanDisplayName(editName);
    if (clean.split(" ").length < 2) {
      setEditError("اكتب الاسم والكنية على الأقل");
      return;
    }
    setSavingEdit(true);
    setEditError("");
    try {
      const res = await renameStudent(editingStudent.id, clean);
      if (res.status === "invalid") {
        setEditError("اكتب الاسم والكنية على الأقل");
        return;
      }
      if (res.status === "duplicate") {
        setEditError(`اسم مكرر: «${res.existing}» موجود مسبقاً`);
        return;
      }
      toast.success("تم تعديل بيانات الطالب");
      if (selectedStudent?.id === editingStudent.id) {
        setSelectedStudent({ ...selectedStudent, full_name: clean });
      }
      void qc.invalidateQueries({ queryKey: ["attendance"] });
      void qc.invalidateQueries({ queryKey: ["public-results"] });
      void qc.invalidateQueries({ queryKey: ["student-attendance", editingStudent.id] });
      await refresh();
      setEditingStudent(null);
    } catch {
      setEditError("تعذّر تعديل بيانات الطالب، حاول مرة أخرى");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <AppShell compact role={role} userName={userName}>
      <section className="rounded-[2rem] p-6 surface">
        <h2 className="font-display flex items-center gap-2 text-2xl">
          <UserPlus className="size-6 text-primary" /> إضافة طالب
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">الاسم والكنية، واسم الأب اختياري</p>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDupes([]);
            }}
            placeholder="مثال: محمد العتيبي أو محمد أحمد العتيبي"
            aria-invalid={!!exactDuplicate || !!similar}
            className="h-12 flex-1 rounded-xl bg-background/40 text-base aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-destructive"
          />
          <Button type="submit" variant="gold" className="h-12 rounded-xl px-8" disabled={busy || !!exactDuplicate}>
            إضافة
          </Button>
        </form>

        {exactDuplicate && (
          <p role="alert" className="mt-3 flex items-center gap-2 rounded-xl border border-destructive bg-destructive/15 px-4 py-3 text-destructive">
            <AlertTriangle className="size-5 shrink-0" /> اسم مكرر: «{exactDuplicate.full_name}» موجود مسبقاً
          </p>
        )}
        {similar && (
          <p role="alert" className="mt-3 flex items-center gap-2 rounded-xl border border-destructive bg-destructive/15 px-4 py-3 text-destructive">
            <AlertTriangle className="size-5 shrink-0" /> تنبيه: يوجد طالب بنفس الاسم والكنية «{similar.full_name}». تأكد أنه شخص مختلف
          </p>
        )}

        {dupes.length > 0 && (
          <div role="alert" className="mt-3 animate-shake rounded-xl border-2 border-destructive bg-destructive/15 px-4 py-3 shadow-danger">
            <p className="flex items-center gap-2 font-semibold text-destructive">
              <AlertTriangle className="size-5" /> أسماء مكررة لم تُضَف:
            </p>
            <ul className="mt-2 list-inside list-disc text-sm text-foreground">
              {dupes.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          onClick={() => setBulkOpen((v) => !v)}
          className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-primary"
        >
          <ListPlus className="size-4" /> إضافة عدة أسماء دفعة واحدة
        </button>
        {bulkOpen && (
          <div className="mt-3 animate-rise">
            <Textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              rows={6}
              placeholder={"اكتب كل اسم في سطر\nمحمد العتيبي\nخالد سعد القحطاني"}
              className="rounded-xl bg-background/40 text-base"
            />
            <Button variant="gold" className="mt-3 rounded-xl" onClick={submitBulk} disabled={busy}>
              إضافة الأسماء
            </Button>
          </div>
        )}
      </section>

      {isAdmin && (
        <section className="mt-6 rounded-[2rem] p-6 surface">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display flex items-center gap-2 text-2xl">
              <Users className="size-6 text-primary" /> الطلاب
            </h2>
            <span className="rounded-full bg-gradient-gold px-4 py-1 text-lg font-bold text-primary-foreground">
              {students.length}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">اضغط على اسم الطالب لعرض عدد أيام حضوره وتواريخها</p>
          <div className="relative mt-4">
            <Search className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث عن طالب" className="h-11 rounded-xl bg-background/40 pr-9" />
          </div>
          {filtered.length === 0 ? (
            <p className="mt-6 text-center text-muted-foreground">
              {students.length === 0 ? "لا يوجد طلاب بعد. أضف أول اسم من الأعلى." : "لا توجد نتائج"}
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {filtered.map((s, i) => (
                <li key={s.id} className="flex items-center gap-2 py-3">
                  <span className="w-8 shrink-0 text-center text-sm text-muted-foreground">{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedStudent(s)}
                    className="flex flex-1 cursor-pointer items-center justify-between gap-2 text-right transition-colors hover:text-primary"
                  >
                    <span className="font-medium underline-offset-4 hover:underline">{s.full_name}</span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <CalendarDays className="size-3.5" />
                      التفاصيل
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`تعديل ${s.full_name}`}
                    onClick={() => openEdit(s)}
                    className="text-muted-foreground hover:text-primary"
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`حذف ${s.full_name}`} className="text-muted-foreground hover:text-destructive">
                        <Trash2 />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent dir="rtl">
                      <AlertDialogHeader>
                        <AlertDialogTitle>حذف {s.full_name}؟</AlertDialogTitle>
                        <AlertDialogDescription>سيُحذف الطالب وجميع أيام حضوره. لا يمكن التراجع.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter className="gap-2">
                        <AlertDialogCancel>إلغاء</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={async () => {
                            try {
                              await deleteStudent(s.id);
                              toast.success("تم الحذف");
                              void qc.invalidateQueries({ queryKey: ["attendance"] });
                              void qc.invalidateQueries({ queryKey: ["public-results"] });
                              void qc.invalidateQueries({ queryKey: ["student-attendance", s.id] });
                              await refresh();
                            } catch {
                              toast.error("تعذّر الحذف");
                            }
                          }}
                        >
                          حذف
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <AlertDialog
        open={pendingTodayAttendance.length > 0}
        onOpenChange={(open) => {
          if (!open && !markingToday) setPendingTodayAttendance([]);
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right sm:text-right">
            <AlertDialogTitle>
              {pendingTodayAttendance.length === 1 ? "هل تريد وضع حضور له لهذا اليوم؟" : "هل تريد وضع حضور لهم لهذا اليوم؟"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTodayAttendance.length === 1
                ? `تمت إضافة «${pendingTodayAttendance[0]?.full_name}». هل تريد تسجيل حضوره اليوم (${formatDateLong(today)})؟`
                : `تمت إضافة ${pendingTodayAttendance.length} طلاب. هل تريد تسجيل حضورهم اليوم (${formatDateLong(today)})؟`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={markingToday}>لا</AlertDialogCancel>
            <AlertDialogAction
              disabled={markingToday}
              onClick={(e) => {
                e.preventDefault();
                void confirmTodayAttendance();
              }}
            >
              {markingToday ? <Loader2 className="size-4 animate-spin" /> : null}
              نعم، تسجيل حضور اليوم
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isAdmin && (
        <Dialog open={!!selectedStudent} onOpenChange={(open) => !open && setSelectedStudent(null)}>
          <DialogContent dir="rtl" className="max-h-[85dvh] overflow-y-auto rounded-[2rem] border-border surface">
            <DialogHeader className="pe-8 text-right sm:text-right">
              <DialogTitle className="font-display text-2xl text-gradient-gold">{selectedStudent?.full_name}</DialogTitle>
              <DialogDescription>سجل حضور الطالب وأيام الحضور المسجلة</DialogDescription>
            </DialogHeader>

            <div className="flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3">
              <span className="text-sm font-medium text-foreground">عدد أيام الحضور</span>
              <span className="rounded-full bg-gradient-gold px-4 py-1 text-lg font-bold text-primary-foreground">
                {studentAttendance.isLoading ? "..." : `${studentAttendance.data?.length ?? 0} يوم`}
              </span>
            </div>

            {studentAttendance.isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="size-6 animate-spin text-primary" />
              </div>
            ) : studentAttendance.isError ? (
              <p className="py-4 text-center text-sm text-destructive">تعذّر تحميل سجل الحضور</p>
            ) : !studentAttendance.data?.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">لا توجد أيام حضور مسجلة لهذا الطالب بعد</p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-2xl border border-border bg-background/30 px-4">
                {studentAttendance.data.map((row, idx) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="w-6 text-xs text-muted-foreground">{idx + 1}</span>
                      <span>{formatDateLong(row.attended_on)}</span>
                    </span>
                    <span className="text-xs text-muted-foreground" dir="ltr">
                      {row.attended_on}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <DialogFooter className="gap-2 sm:justify-start">
              {selectedStudent && (
                <Button type="button" variant="gold" onClick={() => openEdit(selectedStudent)}>
                  <Pencil className="size-4" /> تعديل الاسم
                </Button>
              )}
              <Button type="button" variant="glass" onClick={() => setSelectedStudent(null)}>
                إغلاق
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {isAdmin && (
        <Dialog open={!!editingStudent} onOpenChange={(open) => !open && !savingEdit && setEditingStudent(null)}>
          <DialogContent dir="rtl" className="rounded-[2rem] border-border surface">
            <DialogHeader className="pe-8 text-right sm:text-right">
              <DialogTitle className="font-display text-2xl">تعديل بيانات الطالب</DialogTitle>
              <DialogDescription>عدّل الاسم الكامل للطالب ثم احفظ التغيير</DialogDescription>
            </DialogHeader>
            <form onSubmit={submitEdit} className="space-y-4">
              <Input
                autoFocus
                value={editName}
                onChange={(e) => {
                  setEditName(e.target.value);
                  setEditError("");
                }}
                placeholder="الاسم والكنية"
                className="h-12 rounded-xl bg-background/40 text-base"
                aria-label="اسم الطالب"
              />
              {editDuplicate && (
                <p role="alert" className="flex items-center gap-2 rounded-xl border border-destructive bg-destructive/15 px-3 py-2 text-sm text-destructive">
                  <AlertTriangle className="size-4 shrink-0" /> اسم مكرر: «{editDuplicate.full_name}» موجود مسبقاً
                </p>
              )}
              {editError && (
                <p role="alert" className="flex items-center gap-2 rounded-xl border border-destructive bg-destructive/15 px-3 py-2 text-sm text-destructive">
                  <AlertTriangle className="size-4 shrink-0" /> {editError}
                </p>
              )}
              <DialogFooter className="gap-2 sm:justify-start">
                <Button type="submit" variant="gold" disabled={savingEdit || !!editDuplicate || cleanDisplayName(editName).split(" ").length < 2}>
                  {savingEdit ? <Loader2 className="size-4 animate-spin" /> : null}
                  حفظ التعديل
                </Button>
                <Button type="button" variant="glass" disabled={savingEdit} onClick={() => setEditingStudent(null)}>
                  إلغاء
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </AppShell>
  );
}
