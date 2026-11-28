import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeftRight,
  CalendarDays,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  LockOpen,
  Pencil,
  ShieldCheck,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDateLong, localDateKey } from "@/lib/arabic";
import {
  createStaffAccountApi,
  deleteStaffAccountApi,
  setResultsPublic,
  setTeacherEntryEnabledApi,
  settingsQuery,
  staffAccountsQuery,
  teacherDayRecordingsQuery,
  updateStaffAccountApi,
} from "@/lib/data";
import { STAFF_LIMITS, validateStaffAccountInput } from "@/lib/firebase/domain";
import type { StaffAccountView, StaffRole } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "الإدارة — رجال الفجر" },
      { name: "description", content: "إدارة حسابات المعلمين والمديرين وإظهار النتائج للعامة." },
      { property: "og:title", content: "الإدارة — رجال الفجر" },
      { property: "og:description", content: "إدارة حسابات المعلمين والمديرين وإظهار النتائج للعامة." },
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
  const { role, userName, uid: currentUserUid } = Route.useRouteContext();
  const qc = useQueryClient();
  const settings = useQuery(settingsQuery());
  const staffQuery = useQuery(staffAccountsQuery());

  const teachers = useMemo(
    () => (staffQuery.data ?? []).filter((a) => a.role === "teacher"),
    [staffQuery.data],
  );
  const admins = useMemo(
    () => (staffQuery.data ?? []).filter((a) => a.role === "admin"),
    [staffQuery.data],
  );

  // Create form state
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accountRole, setAccountRole] = useState<StaffRole>("teacher");
  const [busy, setBusy] = useState(false);

  const [toggling, setToggling] = useState(false);
  const [togglingTeacherEntry, setTogglingTeacherEntry] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Edit / Password reset dialog state
  const [editingAccount, setEditingAccount] = useState<StaffAccountView | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<StaffRole>("teacher");
  const [editPassword, setEditPassword] = useState("");
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Recordings dialog state
  const today = localDateKey();
  const [selectedStaff, setSelectedStaff] = useState<StaffAccountView | null>(null);
  const [teacherDate, setTeacherDate] = useState(today);
  const [downloadingTeacher, setDownloadingTeacher] = useState(false);

  const teacherRecordings = useQuery({
    ...teacherDayRecordingsQuery(selectedStaff?.id ?? "", teacherDate),
    enabled: !!selectedStaff && !!teacherDate,
  });

  // Delete dialog state
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState<StaffAccountView | null>(null);

  const isPublic = settings.data?.results_public ?? false;
  const teacherEntryEnabled = settings.data?.teacher_entry_enabled ?? true;

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

  const toggleTeacherEntry = async (value: boolean) => {
    setTogglingTeacherEntry(true);
    try {
      await setTeacherEntryEnabledApi(value);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["settings"] }),
        qc.invalidateQueries({ queryKey: ["teacher-entry"] }),
      ]);
      toast.success(value ? "تم السماح للمعلمين بإدخال البيانات" : "تم منع المعلمين من إدخال البيانات");
    } catch {
      toast.error("تعذّر تحديث صلاحية المعلمين");
    } finally {
      setTogglingTeacherEntry(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const check = validateStaffAccountInput({
      name,
      username,
      password,
      role: accountRole,
      requirePassword: true,
    });
    if (!check.ok) {
      toast.error(check.error);
      return;
    }

    setBusy(true);
    try {
      await createStaffAccountApi({ name, username, password, role: accountRole });
      toast.success(
        accountRole === "admin"
          ? "تم إنشاء حساب المدير مع اسم المستخدم وكلمة المرور"
          : "تم إنشاء حساب المعلم مع اسم المستخدم وكلمة المرور",
      );
      setName("");
      setUsername("");
      setPassword("");
      await qc.invalidateQueries({ queryKey: ["staff-accounts"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر إنشاء الحساب");
    } finally {
      setBusy(false);
    }
  };

  const openEditDialog = (account: StaffAccountView) => {
    setEditingAccount(account);
    setEditName(account.name);
    setEditRole(account.role);
    setEditPassword("");
    setShowEditPassword(false);
    setEditError("");
  };

  const submitEditDialog = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;
    setEditError("");

    const hasNewPwd = editPassword.length > 0;
    const check = validateStaffAccountInput({
      name: editName,
      username: editingAccount.username,
      ...(hasNewPwd ? { password: editPassword } : {}),
      role: editRole,
      requirePassword: hasNewPwd,
    });
    if (!check.ok) {
      setEditError(check.error);
      return;
    }

    setSavingEdit(true);
    try {
      const updated = await updateStaffAccountApi(editingAccount.id, {
        name: editName,
        role: editRole,
        ...(hasNewPwd ? { password: editPassword } : {}),
      });
      if (editingAccount.id === currentUserUid) {
        qc.setQueryData(["staff-session"], {
          uid: updated.id,
          username: updated.username,
          role: updated.role,
          userName: updated.name,
          isPrimaryAdmin: updated.isPrimaryAdmin,
        });
      }
      await qc.invalidateQueries({ queryKey: ["staff-accounts"] });
      toast.success(hasNewPwd ? "تم تحديث بيانات الحساب وكلمة المرور" : "تم تحديث بيانات الحساب");
      setEditingAccount(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "تعذّر تعديل بيانات الحساب");
    } finally {
      setSavingEdit(false);
    }
  };

  const toggleAccountRole = async (account: StaffAccountView) => {
    const nextRole: StaffRole = account.role === "teacher" ? "admin" : "teacher";
    setUpdatingId(account.id);
    try {
      await updateStaffAccountApi(account.id, { name: account.name, role: nextRole });
      toast.success(nextRole === "admin" ? `تمت ترقية ${account.name} إلى مدير` : `تم تحويل ${account.name} إلى معلم`);
      await qc.invalidateQueries({ queryKey: ["staff-accounts"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر تعديل الصلاحية");
    } finally {
      setUpdatingId(null);
    }
  };

  const removeAccount = async (account: StaffAccountView) => {
    setUpdatingId(account.id);
    try {
      await deleteStaffAccountApi(account.id);
      toast.success("تم حذف الحساب");
      setConfirmDeleteAccount(null);
      await qc.invalidateQueries({ queryKey: ["staff-accounts"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر حذف الحساب");
    } finally {
      setUpdatingId(null);
    }
  };

  const downloadTeacherDay = async () => {
    const rows = teacherRecordings.data ?? [];
    if (!selectedStaff || !rows.length) return;
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
      await downloadAttendanceExcel(students, attendance, `${selectedStaff.name}-${teacherDate}`);
      toast.success("تم تنزيل قائمة التسجيلات لهذا اليوم");
    } catch {
      toast.error("تعذّر تنزيل الأسماء");
    } finally {
      setDownloadingTeacher(false);
    }
  };

  const canChangeEditingRole =
    Boolean(editingAccount) && !editingAccount?.isPrimaryAdmin && editingAccount?.id !== currentUserUid;

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

      <section
        className={cn(
          "mt-6 rounded-[2rem] border p-6 surface transition-colors",
          teacherEntryEnabled ? "border-success/40" : "border-destructive/40",
        )}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div
              className={cn(
                "grid size-12 shrink-0 place-items-center rounded-2xl border",
                teacherEntryEnabled
                  ? "border-success/40 bg-success/15 text-success"
                  : "border-destructive/40 bg-destructive/15 text-destructive",
              )}
            >
              {teacherEntryEnabled ? <LockOpen className="size-6" /> : <Lock className="size-6" />}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl">إدخال البيانات للمعلمين</h2>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-0.5 text-xs font-semibold",
                    teacherEntryEnabled ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
                  )}
                >
                  <span className={cn("size-2 rounded-full", teacherEntryEnabled ? "bg-success" : "bg-destructive")} />
                  {teacherEntryEnabled ? "مسموح حالياً" : "ممنوع حالياً"}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {teacherEntryEnabled
                  ? "يستطيع المعلمون تسجيل حضور الطلاب وإضافة أسماء جديدة الآن"
                  : "المعلمون ممنوعون من تسجيل الحضور أو إضافة الطلاب؛ الإدخال متاح للمديرين فقط"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 self-end sm:self-center">
            <Switch
              checked={teacherEntryEnabled}
              disabled={settings.isLoading || togglingTeacherEntry}
              onCheckedChange={toggleTeacherEntry}
              aria-label="السماح للمعلمين بإدخال البيانات"
            />
            <Button
              type="button"
              variant={teacherEntryEnabled ? "glass" : "gold"}
              size="lg"
              disabled={settings.isLoading || togglingTeacherEntry}
              onClick={() => void toggleTeacherEntry(!teacherEntryEnabled)}
              className={cn(
                "min-w-[12rem] rounded-xl font-semibold",
                teacherEntryEnabled && "border-destructive/40 text-destructive hover:bg-destructive/15",
              )}
            >
              {togglingTeacherEntry ? (
                <Loader2 className="size-4 animate-spin" />
              ) : teacherEntryEnabled ? (
                <Lock className="size-4" />
              ) : (
                <LockOpen className="size-4" />
              )}
              {teacherEntryEnabled ? "منع المعلمين من الإدخال" : "السماح للمعلمين بالإدخال"}
            </Button>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-[2rem] p-6 surface">
        <h2 className="font-display flex items-center gap-2 text-2xl">
          <UserPlus className="size-6 text-primary" /> إنشاء حساب معلم أو مدير
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          حدّد الاسم للترحيب واسم المستخدم وكلمة المرور ليتمكّن المعلم أو المدير من الدخول فوراً
        </p>
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
          <div className="grid gap-1.5">
            <Label htmlFor="staff-name" className="text-muted-foreground">
              {accountRole === "admin" ? "اسم المدير (للترحيب)" : "اسم المعلم (للترحيب)"}
            </Label>
            <Input
              id="staff-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={accountRole === "admin" ? "مثال: محمد أحمد" : "مثال: خالد العتيبي"}
              className="h-12 rounded-xl bg-background/40"
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="staff-username" className="text-muted-foreground">
              اسم المستخدم
            </Label>
            <Input
              id="staff-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={accountRole === "admin" ? "admin2" : "khaled"}
              dir="ltr"
              autoComplete="off"
              className="h-12 rounded-xl bg-background/40"
              required
            />
            <span className="text-[11px] text-muted-foreground">
              حروف إنجليزية أو أرقام أو (. _ -) بدون مسافات
            </span>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="staff-password" className="text-muted-foreground">
              كلمة المرور
            </Label>
            <div className="relative" dir="ltr">
              <Input
                id="staff-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                autoComplete="new-password"
                minLength={STAFF_LIMITS.PASSWORD_MIN}
                className="h-12 rounded-xl bg-background/40 pe-11"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                className="absolute inset-y-0 end-0 grid w-11 place-items-center text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" variant="gold" size="xl" disabled={busy}>
            {busy ? <Loader2 className="size-5 animate-spin" /> : <UserPlus className="size-5" />}
            {accountRole === "admin" ? "إنشاء حساب مدير" : "إنشاء حساب معلم"}
          </Button>
        </form>
      </section>

      <section className="mt-6 rounded-[2rem] p-6 surface">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display flex items-center gap-2 text-2xl">
            <ShieldCheck className="size-6 text-primary" /> حسابات المعلمين
          </h2>
          <span className="rounded-full bg-gradient-gold px-3.5 py-0.5 text-base font-bold text-primary-foreground">
            {teachers.length}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          اضغط على اسم المعلم لعرض الطلاب الذين سجّلهم، أو استخدم التعديل لتغيير الاسم أو كلمة المرور
        </p>
        {staffQuery.isLoading ? (
          <div className="mt-4 h-16 animate-pulse rounded-2xl bg-secondary/40" />
        ) : staffQuery.isError ? (
          <p role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            تعذّر تحميل الحسابات
          </p>
        ) : !teachers.length ? (
          <p className="mt-4 text-center text-muted-foreground">لا يوجد معلمون بعد</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {teachers.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-1.5 py-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedStaff(t);
                    setTeacherDate(today);
                  }}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-right transition-colors hover:text-primary"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium underline-offset-4 hover:underline">{t.name}</span>
                      <span className="rounded-md bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                        مفعّل
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground" dir="ltr">
                      {t.username}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-primary">
                    <CalendarDays className="size-3.5" />
                    عرض السجل
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={updatingId === t.id}
                  aria-label={`تعديل حساب أو كلمة مرور ${t.name}`}
                  title="تعديل الحساب أو كلمة المرور"
                  className="text-muted-foreground hover:text-primary"
                  onClick={() => openEditDialog(t)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={updatingId === t.id}
                  aria-label={`ترقية ${t.name} إلى مدير`}
                  title="ترقية إلى مدير"
                  className="text-muted-foreground hover:text-primary"
                  onClick={() => void toggleAccountRole(t)}
                >
                  <ArrowLeftRight className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={updatingId === t.id}
                  aria-label={`حذف ${t.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmDeleteAccount(t)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-[2rem] p-6 surface">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display flex items-center gap-2 text-2xl">
            <ShieldCheck className="size-6 text-primary" /> حسابات المديرين
          </h2>
          <span className="rounded-full bg-gradient-gold px-3.5 py-0.5 text-base font-bold text-primary-foreground">
            {admins.length}
          </span>
        </div>
        {staffQuery.isLoading ? (
          <div className="mt-4 h-16 animate-pulse rounded-2xl bg-secondary/40" />
        ) : !admins.length ? (
          <p className="mt-4 text-center text-muted-foreground">لا يوجد مديرون بعد</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {admins.map((a) => {
              const isSelf = Boolean(currentUserUid && a.id === currentUserUid);
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-1.5 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedStaff(a);
                      setTeacherDate(today);
                    }}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-right transition-colors hover:text-primary"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium underline-offset-4 hover:underline">{a.name}</span>
                        {a.isPrimaryAdmin && (
                          <span className="rounded-md bg-primary/20 px-2 py-0.5 text-[11px] font-medium text-primary">
                            المدير الأساسي
                          </span>
                        )}
                        {isSelf && !a.isPrimaryAdmin && (
                          <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground">
                            أنت
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground" dir="ltr">
                        {a.username}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-primary">
                      <CalendarDays className="size-3.5" />
                      عرض السجل
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={updatingId === a.id}
                    aria-label={`تعديل حساب أو كلمة مرور ${a.name}`}
                    title="تعديل الحساب أو كلمة المرور"
                    className="text-muted-foreground hover:text-primary"
                    onClick={() => openEditDialog(a)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  {!a.isPrimaryAdmin && !isSelf && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={updatingId === a.id}
                        aria-label={`تحويل ${a.name} إلى معلم`}
                        title="تحويل إلى معلم"
                        className="text-muted-foreground hover:text-primary"
                        onClick={() => void toggleAccountRole(a)}
                      >
                        <ArrowLeftRight className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={updatingId === a.id}
                        aria-label={`حذف ${a.name}`}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setConfirmDeleteAccount(a)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Dialog open={!!editingAccount} onOpenChange={(open) => !open && !savingEdit && setEditingAccount(null)}>
        <DialogContent dir="rtl" className="rounded-[2rem] border-border surface sm:max-w-md">
          <DialogHeader className="pe-8 text-right sm:text-right">
            <DialogTitle className="font-display flex items-center gap-2 text-2xl text-gradient-gold">
              <KeyRound className="size-5 text-primary" /> تعديل الحساب وكلمة المرور
            </DialogTitle>
            <DialogDescription>
              اسم المستخدم:{" "}
              <span dir="ltr" className="font-medium text-foreground">
                {editingAccount?.username}
              </span>
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitEditDialog} className="grid gap-3.5">
            {editError && (
              <p
                role="alert"
                className="rounded-xl border border-destructive bg-destructive/15 px-3 py-2 text-sm text-destructive"
              >
                {editError}
              </p>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="edit-staff-name" className="text-muted-foreground">
                الاسم (للترحيب)
              </Label>
              <Input
                id="edit-staff-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-11 rounded-xl bg-background/40"
                required
              />
            </div>

            {canChangeEditingRole && (
              <div className="grid gap-1.5">
                <Label className="text-muted-foreground">الدور</Label>
                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-background/40 p-1">
                  <button
                    type="button"
                    onClick={() => setEditRole("teacher")}
                    className={cn(
                      "cursor-pointer rounded-xl py-2 text-sm font-medium transition-colors",
                      editRole === "teacher" ? "bg-gradient-gold text-primary-foreground shadow-gold" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    معلم
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditRole("admin")}
                    className={cn(
                      "cursor-pointer rounded-xl py-2 text-sm font-medium transition-colors",
                      editRole === "admin" ? "bg-gradient-gold text-primary-foreground shadow-gold" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    مدير
                  </button>
                </div>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="edit-staff-password" className="text-muted-foreground">
                كلمة مرور جديدة (اختياري)
              </Label>
              <div className="relative" dir="ltr">
                <Input
                  id="edit-staff-password"
                  type={showEditPassword ? "text" : "password"}
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="اتركه فارغاً للإبقاء على كلمة المرور الحالية"
                  autoComplete="new-password"
                  minLength={STAFF_LIMITS.PASSWORD_MIN}
                  className="h-11 rounded-xl bg-background/40 pe-11"
                />
                <button
                  type="button"
                  onClick={() => setShowEditPassword((v) => !v)}
                  aria-label={showEditPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  className="absolute inset-y-0 end-0 grid w-11 place-items-center text-muted-foreground hover:text-foreground"
                >
                  {showEditPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2 sm:justify-start">
              <Button type="submit" variant="gold" disabled={savingEdit}>
                {savingEdit ? <Loader2 className="size-4 animate-spin" /> : null}
                حفظ التعديلات
              </Button>
              <Button type="button" variant="glass" disabled={savingEdit} onClick={() => setEditingAccount(null)}>
                إلغاء
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedStaff} onOpenChange={(open) => !open && setSelectedStaff(null)}>
        <DialogContent dir="rtl" className="max-h-[85dvh] overflow-y-auto rounded-[2rem] border-border surface">
          <DialogHeader className="pe-8 text-right sm:text-right">
            <DialogTitle className="font-display text-2xl text-gradient-gold">
              {selectedStaff?.name || selectedStaff?.username}
            </DialogTitle>
            <DialogDescription>
              اختر اليوم لعرض أسماء الطلاب الذين سجّلهم هذا الحساب
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
              <p className="py-4 text-center text-sm text-destructive">تعذّر تحميل السجل</p>
            ) : !teacherRecordings.data?.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">لم يقم هذا الحساب بتسجيل أي طالب في هذا اليوم</p>
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
            <Button type="button" variant="glass" onClick={() => setSelectedStaff(null)}>
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirmDeleteAccount}
        onOpenChange={(open) => {
          if (!open && !updatingId) setConfirmDeleteAccount(null);
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right sm:text-right">
            <AlertDialogTitle>حذف حساب {confirmDeleteAccount?.name}؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم إلغاء صلاحية الدخول للحساب{" "}
              <span dir="ltr" className="font-medium text-foreground">
                {confirmDeleteAccount?.username}
              </span>{" "}
              فوراً.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={!!updatingId}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!updatingId}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (confirmDeleteAccount) void removeAccount(confirmDeleteAccount);
              }}
            >
              {updatingId ? <Loader2 className="size-4 animate-spin" /> : null}
              حذف الحساب
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
