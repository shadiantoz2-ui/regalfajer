import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LOGIN_DOMAIN, loginToEmail } from "./login";

async function assertAdmin(
  supabase: { rpc: (fn: "has_role", args: { _user_id: string; _role: "admin" }) => PromiseLike<{ data: boolean | null }> },
  userId: string,
) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("غير مسموح");
}

async function assertStaff(
  supabase: { rpc: (fn: "is_staff", args: { _user_id: string }) => PromiseLike<{ data: boolean | null }> },
  userId: string,
) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("غير مسموح");
}

function hasLiveSupabaseWithoutAdminKey(): boolean {
  return Boolean(process.env["SUPABASE_URL"] && !process.env["SUPABASE_SERVICE_ROLE_KEY"]);
}

function isInvalidAdminKeyError(message: string | undefined): boolean {
  return /invalid api key|invalid jwt|unauthorized/i.test(message ?? "");
}

const INVALID_KEY_MSG =
  "مفتاح SUPABASE_SERVICE_ROLE_KEY غير صالح أو مفقود. يرجى وضع مفتاح الخدمة الحقيقي (Service Role / Secret key) من لوحة Supabase في Settings > Secrets.";

export type Teacher = { id: string; name: string; login: string; created_at: string; role?: "admin" | "teacher" };

export type StaffRecordingRow = {
  id: string;
  teacherId: string;
  teacherLogin: string;
  teacherName: string;
  studentId: string;
  studentName: string;
  attendedOn: string;
  recordedAt: string;
};

type AuthCtx = {
  supabase: {
    rpc: (fn: "has_role" | "is_staff", args: { _user_id: string; _role?: "admin" }) => PromiseLike<{ data: boolean | null }>;
    auth: { getUser: () => PromiseLike<{ data: { user: { email?: string | null; user_metadata?: Record<string, unknown> } | null } }> };
    from: (table: "attendance") => {
      select: (cols: "student_id") => {
        eq: (col: "attended_on", val: string) => PromiseLike<{ data: { student_id: string }[] | null; error: { message: string } | null }>;
      };
    };
  };
  userId: string;
  claims: Record<string, unknown>;
};

async function resolveCallerProfile(context: AuthCtx): Promise<{ id: string; login: string; name: string; role: "admin" | "teacher" }> {
  await assertStaff(context.supabase, context.userId);
  const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  const role: "admin" | "teacher" = isAdmin ? "admin" : "teacher";

  let email = typeof context.claims["email"] === "string" ? context.claims["email"] : "";
  const rawMeta = context.claims["user_metadata"];
  let fullName =
    rawMeta && typeof rawMeta === "object" && "full_name" in rawMeta && typeof rawMeta.full_name === "string"
      ? rawMeta.full_name.trim()
      : "";

  if (!email || !fullName) {
    try {
      const { data } = await context.supabase.auth.getUser();
      if (!email && data.user?.email) email = data.user.email;
      const metaName = data.user?.user_metadata?.["full_name"];
      if (!fullName && typeof metaName === "string") fullName = metaName.trim();
    } catch {
      /* keep claims metadata */
    }
  }

  const login = (email || context.userId).replace(`@${LOGIN_DOMAIN}`, "");
  const name = fullName || (email.trim().toLowerCase() === "mohamad@gmail.com" ? "محمد حواصلي" : login);

  return { id: context.userId, login, name, role };
}

async function filterActiveAttendance(
  supabase: AuthCtx["supabase"],
  date: string,
  rows: StaffRecordingRow[],
): Promise<StaffRecordingRow[]> {
  if (!rows.length) return [];
  try {
    const { data, error } = await supabase.from("attendance").select("student_id").eq("attended_on", date);
    if (error || !data) return rows;
    const activeIds = new Set(data.map((r) => r.student_id));
    return rows.filter((r) => activeIds.has(r.studentId));
  } catch {
    return rows;
  }
}

export const listTeachers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Teacher[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { listStaffProfilesByRole } = await import("./staff-recordings.server");
    const seenTeachers = await listStaffProfilesByRole("teacher");
    const byId = new Map<string, Teacher>(
      seenTeachers.map((t) => [t.id, { id: t.id, name: t.name, login: t.login, created_at: t.created_at, role: "teacher" as const }]),
    );

    if (!hasLiveSupabaseWithoutAdminKey()) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: roles, error } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "teacher");
        if (!error && roles) {
          const ids = new Set(roles.map((r) => r.user_id));
          if (ids.size) {
            const { data, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
            if (!listErr && data?.users) {
              for (const u of data.users) {
                if (!ids.has(u.id)) continue;
                const login = (u.email ?? "").replace(`@${LOGIN_DOMAIN}`, "");
                const name = String(u.user_metadata?.["full_name"] ?? "").trim() || login;
                byId.set(u.id, {
                  id: u.id,
                  name,
                  login,
                  created_at: u.created_at,
                  role: "teacher" as const,
                });
              }
            }
          }
        }
      } catch {
        /* fallback to active staff profiles */
      }
    }

    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  });

export const listAdmins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Teacher[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { listStaffProfilesByRole } = await import("./staff-recordings.server");
    const seenAdmins = await listStaffProfilesByRole("admin");
    const byId = new Map<string, Teacher>(
      seenAdmins.map((a) => [a.id, { id: a.id, name: a.name, login: a.login, created_at: a.created_at, role: "admin" as const }]),
    );

    if (!hasLiveSupabaseWithoutAdminKey()) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: roles, error } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
        if (!error && roles) {
          const ids = new Set(roles.map((r) => r.user_id));
          if (ids.size) {
            const { data, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
            if (!listErr && data?.users) {
              for (const u of data.users) {
                if (!ids.has(u.id)) continue;
                const login = (u.email ?? "").replace(`@${LOGIN_DOMAIN}`, "");
                const name =
                  String(u.user_metadata?.["full_name"] ?? "").trim() ||
                  (u.email === "mohamad@gmail.com" ? "محمد حواصلي" : login);
                byId.set(u.id, {
                  id: u.id,
                  name,
                  login,
                  created_at: u.created_at,
                  role: "admin" as const,
                });
              }
            }
          }
        }
      } catch {
        /* fallback to active staff profiles */
      }
    }

    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  });

export const recordStaffCheckin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        studentId: z.string().trim().min(1).max(120),
        studentName: z.string().trim().min(1).max(120),
        attendedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const caller = await resolveCallerProfile(context as unknown as AuthCtx);
    const { addStaffRecording, upsertStaffProfile } = await import("./staff-recordings.server");
    await upsertStaffProfile({
      id: caller.id,
      login: caller.login,
      name: caller.name,
      role: caller.role,
      created_at: new Date().toISOString(),
    });
    await addStaffRecording({
      teacherId: caller.id,
      teacherLogin: caller.login,
      teacherName: caller.name,
      studentId: data.studentId,
      studentName: data.studentName,
      attendedOn: data.attendedOn,
    });
    return { ok: true as const };
  });

export const getMyDayRecordings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }): Promise<StaffRecordingRow[]> => {
    const authCtx = context as unknown as AuthCtx;
    const caller = await resolveCallerProfile(authCtx);
    const { listRecordingsForTeacherByDate, upsertStaffProfile } = await import("./staff-recordings.server");
    await upsertStaffProfile({
      id: caller.id,
      login: caller.login,
      name: caller.name,
      role: caller.role,
      created_at: new Date().toISOString(),
    });
    const rows = await listRecordingsForTeacherByDate(caller.id, data.date);
    return filterActiveAttendance(authCtx.supabase, data.date, rows);
  });

export const getTeacherDayRecordings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        teacherId: z.string().trim().min(1).max(120),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<StaffRecordingRow[]> => {
    const authCtx = context as unknown as AuthCtx;
    await assertAdmin(authCtx.supabase, authCtx.userId);
    const { listRecordingsForTeacherByDate } = await import("./staff-recordings.server");
    const rows = await listRecordingsForTeacherByDate(data.teacherId, data.date);
    return filterActiveAttendance(authCtx.supabase, data.date, rows);
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
        role: z.enum(["teacher", "admin"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (hasLiveSupabaseWithoutAdminKey()) {
      return { ok: false as const, error: INVALID_KEY_MSG };
    }
    const targetRole = data.role ?? "teacher";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: loginToEmail(data.login),
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.name },
    });
    if (error || !created.user) {
      if (isInvalidAdminKeyError(error?.message)) {
        return { ok: false as const, error: INVALID_KEY_MSG };
      }
      const exists = /already|registered|exists/i.test(error?.message ?? "");
      return { ok: false as const, error: exists ? "اسم الدخول مستخدم مسبقاً" : "تعذّر إنشاء الحساب" };
    }
    const { error: roleError } = await supabaseAdmin.from("user_roles").insert({ user_id: created.user.id, role: targetRole });
    if (roleError) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      return { ok: false as const, error: "تعذّر إنشاء الحساب" };
    }
    return { ok: true as const };
  });

export const updateTeacherPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().trim().min(1).max(120), password: z.string().min(6).max(72) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (hasLiveSupabaseWithoutAdminKey()) throw new Error(INVALID_KEY_MSG);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.id)
      .eq("role", "teacher")
      .maybeSingle();
    if (roleErr && isInvalidAdminKeyError(roleErr.message)) throw new Error(INVALID_KEY_MSG);
    if (!role) throw new Error("غير موجود");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.id, { password: data.password });
    if (error) throw new Error("تعذّر تغيير كلمة المرور");
    return { ok: true };
  });

export const deleteTeacher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().trim().min(1).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (hasLiveSupabaseWithoutAdminKey()) throw new Error(INVALID_KEY_MSG);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.id)
      .eq("role", "teacher")
      .maybeSingle();
    if (roleErr && isInvalidAdminKeyError(roleErr.message)) throw new Error(INVALID_KEY_MSG);
    if (!role) throw new Error("غير موجود");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.id);
    if (error) throw new Error("تعذّر حذف الحساب");
    return { ok: true };
  });
