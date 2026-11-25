import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanDisplayName, normalizeName } from "@/lib/arabic";
import type { Database } from "./types";

type Row = Record<string, unknown>;

type MockUser = {
  id: string;
  email: string;
  created_at: string;
  user_metadata: Record<string, unknown>;
  role: "admin" | "teacher";
};

const STORAGE_KEY = "rijal_alfajr_mock_session";

function makeMockJwt(userId: string): string {
  const payload = typeof btoa === "function" ? btoa(userId) : Buffer.from(userId).toString("base64");
  return `mock.${payload}.sig`;
}

export function parseMockJwtUserId(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "mock" || !parts[1]) return null;
  try {
    return typeof atob === "function" ? atob(parts[1]) : Buffer.from(parts[1], "base64").toString("utf8");
  } catch {
    return null;
  }
}

const initialStudents = [
  { id: "stu-1", full_name: "محمد أحمد العتيبي", created_at: "2026-10-01T05:00:00.000Z" },
  { id: "stu-2", full_name: "عبدالله خالد القحطاني", created_at: "2026-10-02T05:00:00.000Z" },
  { id: "stu-3", full_name: "سعد فهد الدوسري", created_at: "2026-10-03T05:00:00.000Z" },
  { id: "stu-4", full_name: "عمر عبدالرحمن الشهري", created_at: "2026-10-04T05:00:00.000Z" },
].map((s) => ({ ...s, normalized_name: normalizeName(s.full_name) }));

const todayIso = new Date().toISOString().slice(0, 10);

const state = {
  app_settings: [{ id: 1, results_public: true, updated_at: new Date().toISOString() }],
  students: initialStudents,
  attendance: [
    { id: "att-1", student_id: "stu-1", attended_on: todayIso, created_at: new Date().toISOString() },
    { id: "att-2", student_id: "stu-2", attended_on: todayIso, created_at: new Date().toISOString() },
  ],
  users: [
    {
      id: "user-admin-1",
      email: "admin@rijal-alfajr.app",
      created_at: "2026-10-01T00:00:00.000Z",
      user_metadata: { full_name: "المدير" },
      role: "admin" as const,
    },
    {
      id: "user-admin-2",
      email: "mohamad@gmail.com",
      created_at: "2026-10-01T00:00:00.000Z",
      user_metadata: { full_name: "محمد حواصلي" },
      role: "admin" as const,
    },
    {
      id: "user-teacher-1",
      email: "teacher@rijal-alfajr.app",
      created_at: "2026-10-02T00:00:00.000Z",
      user_metadata: { full_name: "أحمد المعلم" },
      role: "teacher" as const,
    },
  ] as MockUser[],
  assistant_chats: [] as { user_id: string; messages: unknown[]; updated_at: string }[],
};

function readStoredUser(): MockUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: MockUser };
    return parsed.user ?? null;
  } catch {
    return null;
  }
}

function writeStoredUser(user: MockUser | null) {
  if (typeof window === "undefined") return;
  try {
    if (!user) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ user }));
  } catch {
    /* ignore storage errors */
  }
}

let idSeq = 100;
const nextId = (prefix: string) => `${prefix}-${++idSeq}`;

function makeQueryBuilder(table: string) {
  let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  let payload: unknown = null;
  let upsertIgnoreDupes = false;
  let selectCols = "";
  const eqFilters: Array<[string, unknown]> = [];
  const gteFilters: Array<[string, string]> = [];
  const lteFilters: Array<[string, string]> = [];
  let orderBy: { col: string; ascending: boolean } | null = null;
  let rangeBounds: [number, number] | null = null;
  let mode: "many" | "single" | "maybeSingle" = "many";

  const matchRow = (row: Row) => {
    for (const [col, val] of eqFilters) {
      if (row[col] !== val) return false;
    }
    for (const [col, val] of gteFilters) {
      if (String(row[col] ?? "") < val) return false;
    }
    for (const [col, val] of lteFilters) {
      if (String(row[col] ?? "") > val) return false;
    }
    return true;
  };

  const enrichRow = (row: Row): Row => {
    if (table === "attendance" && selectCols.includes("students(")) {
      const student = state.students.find((s) => s.id === row["student_id"]);
      return { ...row, students: student ? { full_name: student.full_name } : null };
    }
    return { ...row };
  };

  const execute = async (): Promise<{ data: unknown; error: { message: string; code?: string } | null }> => {
    if (table === "user_roles") {
      if (op === "select") {
        const rows = state.users
          .map((u) => ({ id: `role-${u.id}`, user_id: u.id, role: u.role }))
          .filter(matchRow);
        if (mode === "single" || mode === "maybeSingle") {
          return { data: rows[0] ?? null, error: null };
        }
        return { data: rows, error: null };
      }
      if (op === "insert" && payload && typeof payload === "object") {
        const row = payload as { user_id?: string; role?: "admin" | "teacher" };
        const user = state.users.find((u) => u.id === row.user_id);
        if (user && row.role) user.role = row.role;
        return { data: payload, error: null };
      }
      return { data: null, error: null };
    }

    const rows =
      table === "app_settings"
        ? (state.app_settings as unknown as Row[])
        : table === "students"
          ? (state.students as unknown as Row[])
          : table === "attendance"
            ? (state.attendance as unknown as Row[])
            : table === "assistant_chats"
              ? (state.assistant_chats as unknown as Row[])
              : [];

    if (op === "select") {
      let result = rows.filter(matchRow).map(enrichRow);
      if (orderBy) {
        const { col, ascending } = orderBy;
        result.sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          return ascending ? av.localeCompare(bv, "ar") : bv.localeCompare(av, "ar");
        });
      }
      if (rangeBounds) {
        result = result.slice(rangeBounds[0], rangeBounds[1] + 1);
      }
      if (mode === "single") {
        return result[0] ? { data: result[0], error: null } : { data: null, error: { message: "Not found" } };
      }
      if (mode === "maybeSingle") {
        return { data: result[0] ?? null, error: null };
      }
      return { data: result, error: null };
    }

    if (op === "insert") {
      const items = (Array.isArray(payload) ? payload : [payload]) as Row[];
      const inserted: Row[] = [];
      for (const item of items) {
        if (table === "students") {
          const full_name = cleanDisplayName(String(item["full_name"] ?? ""));
          const normalized_name = String(item["normalized_name"] ?? normalizeName(full_name));
          if (state.students.some((s) => s.normalized_name === normalized_name)) {
            return { data: null, error: { message: "duplicate key value", code: "23505" } };
          }
          const created = {
            id: nextId("stu"),
            full_name,
            normalized_name,
            created_at: new Date().toISOString(),
          };
          state.students.push(created);
          inserted.push(created);
        } else if (table === "attendance") {
          const student_id = String(item["student_id"] ?? "");
          const attended_on = String(item["attended_on"] ?? "");
          if (state.attendance.some((a) => a.student_id === student_id && a.attended_on === attended_on)) {
            return { data: null, error: { message: "duplicate key value", code: "23505" } };
          }
          const created = {
            id: nextId("att"),
            student_id,
            attended_on,
            created_at: new Date().toISOString(),
          };
          state.attendance.push(created);
          inserted.push(created);
        }
      }
      const out = mode === "single" || mode === "maybeSingle" ? (inserted[0] ?? null) : inserted;
      return { data: out, error: null };
    }

    if (op === "upsert") {
      const items = (Array.isArray(payload) ? payload : [payload]) as Row[];
      const inserted: Row[] = [];
      for (const item of items) {
        if (table === "attendance") {
          const student_id = String(item["student_id"] ?? "");
          const attended_on = String(item["attended_on"] ?? "");
          const exists = state.attendance.some((a) => a.student_id === student_id && a.attended_on === attended_on);
          if (exists && upsertIgnoreDupes) continue;
          if (!exists) {
            const created = {
              id: nextId("att"),
              student_id,
              attended_on,
              created_at: new Date().toISOString(),
            };
            state.attendance.push(created);
            inserted.push(created);
          }
        } else if (table === "assistant_chats") {
          const user_id = String(item["user_id"] ?? "");
          const messages = Array.isArray(item["messages"]) ? item["messages"] : [];
          const updated_at = String(item["updated_at"] ?? new Date().toISOString());
          const existing = state.assistant_chats.find((c) => c.user_id === user_id);
          if (existing) {
            existing.messages = messages;
            existing.updated_at = updated_at;
          } else {
            state.assistant_chats.push({ user_id, messages, updated_at });
          }
          inserted.push({ user_id, messages, updated_at });
        }
      }
      return { data: inserted, error: null };
    }

    if (op === "update" && payload && typeof payload === "object") {
      const patch = payload as Row;
      for (const row of rows) {
        if (!matchRow(row)) continue;
        if (table === "students" && typeof patch["normalized_name"] === "string") {
          const dup = state.students.some(
            (s) => s.id !== row["id"] && s.normalized_name === patch["normalized_name"],
          );
          if (dup) return { data: null, error: { message: "duplicate key value", code: "23505" } };
        }
        Object.assign(row, patch);
      }
      return { data: null, error: null };
    }

    if (op === "delete") {
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (!row || !matchRow(row)) continue;
        if (table === "students") {
          const sid = row["id"];
          state.attendance = state.attendance.filter((a) => a.student_id !== sid);
        }
        rows.splice(i, 1);
      }
      return { data: null, error: null };
    }

    return { data: null, error: null };
  };

  const builder = {
    select(cols = "*") {
      selectCols = cols;
      return builder;
    },
    insert(data: unknown) {
      op = "insert";
      payload = data;
      return builder;
    },
    update(data: unknown) {
      op = "update";
      payload = data;
      return builder;
    },
    upsert(data: unknown, opts?: { ignoreDuplicates?: boolean }) {
      op = "upsert";
      payload = data;
      upsertIgnoreDupes = Boolean(opts?.ignoreDuplicates);
      return builder;
    },
    delete() {
      op = "delete";
      return builder;
    },
    eq(col: string, val: unknown) {
      eqFilters.push([col, val]);
      return builder;
    },
    gte(col: string, val: string) {
      gteFilters.push([col, val]);
      return builder;
    },
    lte(col: string, val: string) {
      lteFilters.push([col, val]);
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderBy = { col, ascending: opts?.ascending ?? true };
      return builder;
    },
    range(from: number, to: number) {
      rangeBounds = [from, to];
      return builder;
    },
    single() {
      mode = "single";
      return builder;
    },
    maybeSingle() {
      mode = "maybeSingle";
      return builder;
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown; error: { message: string; code?: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
    },
  };

  return builder;
}

export function createMockSupabaseClient(activeUserId?: string): SupabaseClient<Database> {
  const resolveUser = (token?: string): MockUser | null => {
    if (token) {
      const uid = parseMockJwtUserId(token);
      if (uid) return state.users.find((u) => u.id === uid) ?? state.users[0] ?? null;
    }
    if (activeUserId) {
      return state.users.find((u) => u.id === activeUserId) ?? state.users[0] ?? null;
    }
    return readStoredUser();
  };

  const client = {
    auth: {
      async getSession() {
        const user = resolveUser();
        if (!user) return { data: { session: null }, error: null };
        return {
          data: { session: { access_token: makeMockJwt(user.id), user } },
          error: null,
        };
      },
      async getUser(token?: string) {
        const user = resolveUser(token);
        return { data: { user }, error: null };
      },
      async getClaims(token: string) {
        const user = resolveUser(token);
        if (!user) return { data: null, error: { message: "Unauthorized" } };
        return { data: { claims: { sub: user.id } }, error: null };
      },
      async signInWithPassword({ email }: { email: string; password: string }) {
        const normalized = email.trim().toLowerCase();
        let user = state.users.find((u) => u.email.toLowerCase() === normalized);
        if (!user) {
          user = {
            id: nextId("user"),
            email: normalized,
            created_at: new Date().toISOString(),
            user_metadata: { full_name: normalized.split("@")[0] ?? "المدير" },
            role: normalized.startsWith("teacher") ? "teacher" : "admin",
          };
          state.users.push(user);
        }
        writeStoredUser(user);
        return {
          data: { user, session: { access_token: makeMockJwt(user.id), user } },
          error: null,
        };
      },
      async signOut() {
        writeStoredUser(null);
        return { error: null };
      },
      admin: {
        async listUsers() {
          return { data: { users: state.users }, error: null };
        },
        async createUser({
          email,
          user_metadata,
        }: {
          email: string;
          password: string;
          email_confirm?: boolean;
          user_metadata?: Record<string, unknown>;
        }) {
          const normalized = email.trim().toLowerCase();
          if (state.users.some((u) => u.email.toLowerCase() === normalized)) {
            return { data: { user: null }, error: { message: "User already registered" } };
          }
          const user: MockUser = {
            id: nextId("user"),
            email: normalized,
            created_at: new Date().toISOString(),
            user_metadata: user_metadata ?? {},
            role: "teacher",
          };
          state.users.push(user);
          return { data: { user }, error: null };
        },
        async updateUserById() {
          return { data: { user: null }, error: null };
        },
        async deleteUser(id: string) {
          state.users = state.users.filter((u) => u.id !== id);
          return { data: { user: null }, error: null };
        },
      },
    },
    from(table: string) {
      return makeQueryBuilder(table);
    },
    async rpc(fn: string, args?: Record<string, unknown>) {
      if (fn === "public_results") {
        if (!state.app_settings[0]?.results_public) return { data: [], error: null };
        const counts = new Map<string, number>();
        for (const a of state.attendance) {
          counts.set(a.student_id, (counts.get(a.student_id) ?? 0) + 1);
        }
        const rows = state.students
          .map((s) => ({ full_name: s.full_name, days: counts.get(s.id) ?? 0 }))
          .sort((a, b) => b.days - a.days || a.full_name.localeCompare(b.full_name, "ar"));
        return { data: rows, error: null };
      }
      if (fn === "has_role") {
        const uid = String(args?.["_user_id"] ?? "");
        const role = String(args?.["_role"] ?? "");
        const user = state.users.find((u) => u.id === uid);
        return { data: user?.role === role, error: null };
      }
      if (fn === "is_staff") {
        const uid = String(args?.["_user_id"] ?? "");
        const user = state.users.find((u) => u.id === uid);
        return { data: Boolean(user), error: null };
      }
      return { data: null, error: null };
    },
    channel() {
      const ch = {
        on() {
          return ch;
        },
        subscribe() {
          return ch;
        },
      };
      return ch;
    },
    async removeChannel() {
      return "ok";
    },
  };

  return client as unknown as SupabaseClient<Database>;
}
