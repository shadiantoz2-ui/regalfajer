import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { settingsQuery, setResultsPublic } from "@/lib/data";
import { createTeacher, deleteTeacher, listTeachers } from "@/lib/staff.functions";

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
  const create = useServerFn(createTeacher);
  const remove = useServerFn(deleteTeacher);
  const settings = useQuery(settingsQuery());
  const teachers = useQuery({ queryKey: ["teachers"], queryFn: () => list() });

  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = async (value: boolean) => {
    try {
      await setResultsPublic(value);
      await qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success(value ? "النتائج ظاهرة للعامة الآن" : "تم إيقاف عرض النتائج");
    } catch {
      toast.error("تعذّر التغيير");
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await create({ data: { name, login, password } });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("تم إنشاء حساب المعلم");
        setName("");
        setLogin("");
        setPassword("");
        await qc.invalidateQueries({ queryKey: ["teachers"] });
      }
    } catch {
      toast.error("تأكد من البيانات: اسم الدخول بحروف إنجليزية وكلمة مرور 6 أحرف على الأقل");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell compact role={role} userName={userName}>
      <section className="flex items-center justify-between gap-4 rounded-[2rem] p-6 surface">
        <div>
          <h2 className="font-display text-xl">عرض النتائج للعامة</h2>
          <p className="mt-1 text-sm text-muted-foreground">عند التفعيل تظهر عدد أيام حضور كل طالب في الصفحة الرئيسية</p>
        </div>
        <Switch
          checked={settings.data?.results_public ?? false}
          disabled={settings.isLoading}
          onCheckedChange={toggle}
          aria-label="عرض النتائج للعامة"
        />
      </section>

      <section className="mt-6 rounded-[2rem] p-6 surface">
        <h2 className="font-display flex items-center gap-2 text-2xl">
          <UserPlus className="size-6 text-primary" /> إضافة معلم
        </h2>
        <form onSubmit={submit} className="mt-4 grid gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم المعلم" className="h-12 rounded-xl bg-background/40" required />
          <Input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="اسم الدخول (بالإنجليزية) أو البريد" dir="ltr" className="h-12 rounded-xl bg-background/40" required />
          <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="كلمة المرور (6 أحرف على الأقل)" dir="ltr" className="h-12 rounded-xl bg-background/40" required />
          <Button type="submit" variant="gold" size="xl" disabled={busy}>
            إنشاء الحساب
          </Button>
        </form>
      </section>

      <section className="mt-6 rounded-[2rem] p-6 surface">
        <h2 className="font-display flex items-center gap-2 text-2xl">
          <ShieldCheck className="size-6 text-primary" /> المعلمون
        </h2>
        {teachers.isLoading ? (
          <div className="mt-4 h-16 animate-pulse rounded-2xl bg-secondary/40" />
        ) : !teachers.data?.length ? (
          <p className="mt-4 text-center text-muted-foreground">لا يوجد معلمون بعد</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {teachers.data.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-3">
                <span className="flex-1">{t.name}</span>
                <span className="text-sm text-muted-foreground" dir="ltr">{t.login}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`حذف ${t.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    if (!window.confirm(`حذف حساب ${t.name}؟`)) return;
                    await remove({ data: { id: t.id } });
                    toast.success("تم حذف الحساب");
                    await qc.invalidateQueries({ queryKey: ["teachers"] });
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
