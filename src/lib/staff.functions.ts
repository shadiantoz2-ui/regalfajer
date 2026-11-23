import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LOGIN_DOMAIN, loginToEmail } from "./login";


async function assertAdmin(supabase: { rpc: (fn: "has_role", args: { _user_id: string; _role: "admin" }) => PromiseLike<{ data: boolean | null }> }, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("غير مسموح");
}

export type Teacher = { id: string; name: string; login: string; created_at: string };

export const listTeachers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Teacher[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles, error } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "teacher");
    if (error) throw new Error(error.message);
    const ids = new Set((roles ?? []).map((r) => r.user_id));
    if (!ids.size) return [];
    const { data } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    return (data?.users ?? [])
      .filter((u) => ids.has(u.id))
      .map((u) => ({
        id: u.id,
        name: String(u.user_metadata?.["full_name"] ?? ""),
        login: (u.email ?? "").replace(`@${LOGIN_DOMAIN}`, ""),
        created_at: u.created_at,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  });

export const createTeacher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        name: z.string().trim().min(2).max(80),
        login: z
          .string()
          .trim()
          .min(3)
          .max(80)
          .regex(/^[a-zA-Z0-9._@+-]+$/),
        password: z.string().min(6).max(72),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: loginToEmail(data.login),
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.name },
    });
    if (error || !created.user) {
      const exists = /already|registered|exists/i.test(error?.message ?? "");
      return { ok: false as const, error: exists ? "اسم الدخول مستخدم مسبقاً" : "تعذّر إنشاء الحساب" };
    }
    const { error: roleError } = await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: "teacher" });
    if (roleError) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      return { ok: false as const, error: "تعذّر إنشاء الحساب" };
    }
    return { ok: true as const };
  });

export const updateTeacherPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), password: z.string().min(6).max(72) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", data.id).eq("role", "teacher").maybeSingle();
    if (!role) throw new Error("غير موجود");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.id, { password: data.password });
    if (error) throw new Error("تعذّر تغيير كلمة المرور");
    return { ok: true };
  });

export const deleteTeacher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", data.id).eq("role", "teacher").maybeSingle();
    if (!role) throw new Error("غير موجود");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.id);
    if (error) throw new Error("تعذّر حذف الحساب");
    return { ok: true };
  });
