import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { LOGIN_DOMAIN, loginToEmail } from "@/lib/login";

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

function AuthPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error: err } = await supabase.auth.signInWithPassword({ email: loginToEmail(login), password });
    if (err) {
      setBusy(false);
      const isKeyErr = /api key|forbidden|secret/i.test(err.message);
      setError(
        isKeyErr
          ? "مفتاح الاتصال بقاعدة البيانات غير صالح — تحقّق من VITE_SUPABASE_PUBLISHABLE_KEY"
          : "اسم الدخول أو كلمة المرور غير صحيحة",
      );
      return;
    }
    qc.removeQueries({ queryKey: ["staff-session"] });
    if (data.user) {
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
      const list = (roles ?? []).map((r) => r.role);
      if (list.includes("admin") || list.includes("teacher")) {
        const email = (data.user.email ?? "").trim().toLowerCase();
        const rawName = String(data.user.user_metadata?.["full_name"] ?? "").trim();
        const displayName =
          rawName || (email === "mohamad@gmail.com" ? "محمد حواصلي" : (data.user.email ?? "").replace(`@${LOGIN_DOMAIN}`, ""));
        toast.success(displayName ? `أهلا وسهلا بالأستاذ ${displayName}` : "أهلا وسهلا بالأستاذ");
      }
    }
    setBusy(false);
    navigate({ to: "/checkin", replace: true });
  };

  return (
    <AppShell compact>
      <form onSubmit={submit} className="mx-auto max-w-md rounded-[2rem] p-7 surface">
        <h2 className="font-display text-center text-2xl">دخول الإدارة والمعلمين</h2>
        <div className="mt-6 flex flex-col gap-1.5">
          <Label htmlFor="login" className="text-muted-foreground">
            البريد أو اسم الدخول
          </Label>
          <Input
            id="login"
            dir="ltr"
            autoComplete="username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            className="h-12 rounded-xl bg-background/40 text-base"
            required
          />
        </div>
        <div className="mt-4 flex flex-col gap-1.5">
          <Label htmlFor="password" className="text-muted-foreground">
            كلمة المرور
          </Label>
          <Input
            id="password"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 rounded-xl bg-background/40 text-base"
            required
          />
        </div>
        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-destructive bg-destructive/15 px-4 py-3 text-center text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" variant="gold" size="xl" className="mt-6 w-full" disabled={busy}>
          {busy ? <Loader2 className="size-5 animate-spin" /> : <LogIn className="size-5" />}
          دخول
        </Button>
        <p className="mt-4 text-center text-xs text-muted-foreground">حسابات المعلمين ينشئها المدير فقط</p>
      </form>
    </AppShell>
  );
}
