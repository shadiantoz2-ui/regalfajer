import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  RefreshCw,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchAuthState, loginWithPassword, setupPrimaryAdminAccount } from "@/lib/data";
import { validateStaffAccountInput } from "@/lib/firebase/domain";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "دخول الإدارة والمعلمين — رجال الفجر" },
      { name: "description", content: "تسجيل دخول الإدارة والمعلمين لتسجيل حضور طلاب رجال الفجر." },
      { property: "og:title", content: "دخول الإدارة والمعلمين — رجال الفجر" },
      { property: "og:description", content: "تسجيل دخول الإدارة والمعلمين لتسجيل حضور طلاب رجال الفجر." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function toSessionContext(user: { id: string; username: string; name: string; role: "admin" | "teacher"; isPrimaryAdmin: boolean }) {
  return {
    uid: user.id,
    username: user.username,
    role: user.role,
    userName: user.name,
    isPrimaryAdmin: user.isPrimaryAdmin,
  };
}

function AuthPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [initError, setInitError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const loadAuthState = useCallback(async () => {
    setChecking(true);
    setInitError("");
    setError("");
    try {
      const state = await fetchAuthState();
      if (state.user) {
        qc.setQueryData(["staff-session"], toSessionContext(state.user));
        navigate({ to: "/checkin", replace: true });
        return;
      }
      setNeedsSetup(state.needsSetup);
    } catch {
      setInitError("تعذّر التحقق من حالة النظام حالياً، حاول مجدداً");
    } finally {
      setChecking(false);
    }
  }, [navigate, qc]);

  useEffect(() => {
    void loadAuthState();
  }, [loadAuthState]);

  const handleBootstrapSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    const check = validateStaffAccountInput({
      name: fullName,
      username,
      password,
      role: "admin",
      requirePassword: true,
    });
    if (!check.ok) {
      setError(check.error);
      return;
    }
    if (password !== confirmPassword) {
      setError("كلمتا المرور غير متطابقتين");
      return;
    }

    setBusy(true);
    try {
      const user = await setupPrimaryAdminAccount({
        name: fullName,
        username,
        password,
      });
      qc.removeQueries({ queryKey: ["staff-session"] });
      qc.setQueryData(["staff-session"], toSessionContext(user));
      toast.success(`تم إنشاء حساب المدير بنجاح، أهلاً بك يا ${user.name}`);
      navigate({ to: "/checkin", replace: true });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "تعذّر إنشاء حساب المدير");
    } finally {
      setBusy(false);
    }
  };

  const handleSignInSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    const cleanLogin = username.trim();
    if (!cleanLogin || !password) {
      setError("أدخل اسم المستخدم وكلمة المرور");
      return;
    }

    setBusy(true);
    try {
      const user = await loginWithPassword({ username: cleanLogin, password });
      qc.removeQueries({ queryKey: ["staff-session"] });
      qc.setQueryData(["staff-session"], toSessionContext(user));
      toast.success(`أهلاً وسهلاً بالأستاذ ${user.name}`);
      navigate({ to: "/checkin", replace: true });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "اسم المستخدم أو كلمة المرور غير صحيحة");
    } finally {
      setBusy(false);
    }
  };

  const isSetupMode = needsSetup === true;

  return (
    <AppShell compact>
      <div className="mx-auto max-w-md rounded-[2rem] p-6 surface">
        <div className="flex flex-col items-center text-center">
          <div className="grid size-12 place-items-center rounded-2xl border border-primary/35 bg-primary/10 text-primary">
            {isSetupMode ? <UserCheck className="size-6" /> : <ShieldCheck className="size-6" />}
          </div>
          <h2 className="font-display mt-3 text-2xl">
            {isSetupMode ? "إعداد حساب المدير الأساسي" : "دخول الإدارة والمعلمين"}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground sm:text-sm">
            {isSetupMode
              ? "لأول دخول: اختر اسمك واسم المستخدم وكلمة المرور الخاصة بك كمدير للنظام"
              : "أدخل اسم المستخدم وكلمة المرور المسجّلة من الإدارة"}
          </p>
        </div>

        {checking ? (
          <div className="mt-8 flex flex-col items-center gap-3 py-6 text-muted-foreground">
            <Loader2 className="size-7 animate-spin text-primary" />
            <span className="text-sm">جارِ التحقق من حالة النظام…</span>
          </div>
        ) : initError ? (
          <div className="mt-6 space-y-4">
            <p
              role="alert"
              className="rounded-xl border border-destructive bg-destructive/15 px-4 py-3 text-center text-sm text-destructive"
            >
              {initError}
            </p>
            <Button type="button" variant="gold" size="xl" className="w-full" onClick={() => void loadAuthState()}>
              <RefreshCw className="size-5" />
              إعادة المحاولة
            </Button>
          </div>
        ) : isSetupMode ? (
          <form onSubmit={handleBootstrapSubmit} className="mt-5 grid gap-3">
            {error && (
              <p
                role="alert"
                className="rounded-xl border border-destructive bg-destructive/15 px-4 py-2.5 text-center text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <div className="grid gap-1">
              <Label htmlFor="admin-setup-name" className="text-muted-foreground">
                اسم المدير (للترحيب)
              </Label>
              <Input
                id="admin-setup-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="مثال: محمد العبدالله"
                className="h-11 rounded-xl bg-background/40"
                autoComplete="name"
                required
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="admin-setup-username" className="text-muted-foreground">
                اسم المستخدم (للدخول لاحقاً)
              </Label>
              <Input
                id="admin-setup-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                dir="ltr"
                autoComplete="username"
                className="h-11 rounded-xl bg-background/40"
                required
              />
              <span className="text-[11px] text-muted-foreground">
                حروف إنجليزية أو أرقام أو (. _ -) بدون مسافات
              </span>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="admin-setup-password" className="text-muted-foreground">
                كلمة المرور
              </Label>
              <div className="relative" dir="ltr">
                <Input
                  id="admin-setup-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  autoComplete="new-password"
                  minLength={6}
                  className="h-11 rounded-xl bg-background/40 pe-11"
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
            <div className="grid gap-1">
              <Label htmlFor="admin-setup-confirm" className="text-muted-foreground">
                تأكيد كلمة المرور
              </Label>
              <Input
                id="admin-setup-confirm"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••"
                dir="ltr"
                autoComplete="new-password"
                minLength={6}
                className="h-11 rounded-xl bg-background/40"
                required
              />
            </div>
            <Button type="submit" variant="gold" size="xl" className="mt-1 w-full" disabled={busy}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : <KeyRound className="size-5" />}
              إنشاء حساب المدير والدخول
            </Button>
          </form>
        ) : (
          <form onSubmit={handleSignInSubmit} className="mt-5 grid gap-3.5">
            {error && (
              <p
                role="alert"
                className="rounded-xl border border-destructive bg-destructive/15 px-4 py-3 text-center text-sm text-destructive"
              >
                {error}
              </p>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="login-username" className="text-muted-foreground">
                اسم المستخدم
              </Label>
              <Input
                id="login-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                dir="ltr"
                autoComplete="username"
                className="h-12 rounded-xl bg-background/40"
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="login-password" className="text-muted-foreground">
                كلمة المرور
              </Label>
              <div className="relative" dir="ltr">
                <Input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
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
            <Button type="submit" variant="gold" size="xl" className="mt-1 w-full" disabled={busy}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : <LogIn className="size-5" />}
              دخول
            </Button>
            <p className="mt-1 text-center text-xs text-muted-foreground">
              يُنشئ المدير حسابات المعلمين والمديرين من صفحة «الإدارة»
            </p>
          </form>
        )}
      </div>
    </AppShell>
  );
}
