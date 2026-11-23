import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, ListPlus, Search, Trash2, UserPlus, Users } from "lucide-react";
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
import { addStudent, deleteStudent, studentsQuery } from "@/lib/data";
import { cleanDisplayName, normalizeName, sameFirstAndFamily } from "@/lib/arabic";

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
  beforeLoad: ({ context }) => {
    if (context.role !== "admin") throw redirect({ to: "/checkin" });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(studentsQuery()),
  component: StudentsPage,
});

function StudentsPage() {
  const { role, userName } = Route.useRouteContext();
  const { data: students } = useSuspenseQuery(studentsQuery());
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const [dupes, setDupes] = useState<string[]>([]);
  const [q, setQ] = useState("");

  const exact = useMemo(() => new Map(students.map((s) => [normalizeName(s.full_name), s])), [students]);
  const typed = name.trim().length > 2 ? name : "";
  const exactDuplicate = typed ? exact.get(normalizeName(typed)) : undefined;
  const similar = typed && !exactDuplicate ? students.find((s) => sameFirstAndFamily(s.full_name, typed)) : undefined;

  const filtered = useMemo(() => {
    const n = normalizeName(q);
    return n ? students.filter((s) => normalizeName(s.full_name).includes(n)) : students;
  }, [q, students]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["students"] });

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
    const created: string[] = [];
    const duplicates: string[] = [];
    try {
      for (const n of names) {
        const res = await addStudent(n);
        if (res.status === "created") created.push(n);
        else if (res.status === "duplicate") duplicates.push(n);
      }
      setDupes(duplicates);
      if (created.length) toast.success(`تمت إضافة ${created.length} طالب`);
      setBulk("");
      setBulkOpen(false);
      await refresh();
    } catch {
      toast.error("تعذّرت الإضافة، حاول مرة أخرى");
    } finally {
      setBusy(false);
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

      <section className="mt-6 rounded-[2rem] p-6 surface">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display flex items-center gap-2 text-2xl">
            <Users className="size-6 text-primary" /> الطلاب
          </h2>
          <span className="rounded-full bg-gradient-gold px-4 py-1 text-lg font-bold text-primary-foreground">
            {students.length}
          </span>
        </div>
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
              <li key={s.id} className="flex items-center gap-3 py-3">
                <span className="w-8 text-center text-sm text-muted-foreground">{i + 1}</span>
                <span className="flex-1">{s.full_name}</span>
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
    </AppShell>
  );
}
