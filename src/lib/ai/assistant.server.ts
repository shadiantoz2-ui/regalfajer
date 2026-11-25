/** Admin-only AI assistant: answers questions about students and attendance using read-only data tools. */
import { createOpenAI } from "@ai-sdk/openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { convertToModelMessages, isStepCount, streamText, tool, validateUIMessages, type UIMessage } from "ai";
import { z } from "zod/v4";
import type { Database } from "@/integrations/supabase/types";
import { createMockSupabaseClient, parseMockJwtUserId } from "@/integrations/supabase/mock";
import { nameSimilarity } from "@/lib/arabic";
import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "./run-id.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
const MODEL = "openai/gpt-6-astra";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Db = SupabaseClient<Database>;
type Student = { id: string; full_name: string; created_at: string };
type Att = { student_id: string; attended_on: string };

function json(status: number, message: string) {
  return Response.json({ error: { message } }, { status });
}

/** Client acting as the signed-in user, so row-level rules apply to every read and write. */
async function adminClient(request: Request): Promise<{ db: Db; userId: string } | null> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token.split(".").length !== 3) return null;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    const uid = parseMockJwtUserId(token);
    if (!uid) return null;
    const db = createMockSupabaseClient(uid);
    const { data: isAdmin } = await db.rpc("has_role", { _user_id: uid, _role: "admin" });
    return isAdmin === true ? { db, userId: uid } : null;
  }
  const db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  const { data: userData } = await db.auth.getUser(token);
  const userId = userData.user?.id;
  if (!userId) return null;
  const { data: isAdmin } = await db.rpc("has_role", { _user_id: userId, _role: "admin" });
  return isAdmin === true ? { db, userId } : null;
}

function dataLoader(db: Db) {
  let cache: Promise<{ students: Student[]; attendance: Att[] }> | null = null;
  const load = async () => {
    const students: Student[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("students")
        .select("id, full_name, created_at")
        .order("full_name")
        .range(from, from + 999);
      if (error) throw error;
      students.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const attendance: Att[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("attendance")
        .select("student_id, attended_on")
        .order("attended_on")
        .range(from, from + 999);
      if (error) throw error;
      attendance.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return { students, attendance };
  };
  return () => (cache ??= load());
}

function inRange(d: string, from: string | null, to: string | null) {
  return (!from || d >= from) && (!to || d <= to);
}

const dateArg = z.string().regex(DATE_RE).nullable().describe("YYYY-MM-DD, or null for no limit");

function buildTools(data: ReturnType<typeof dataLoader>) {
  return {
    overview: tool({
      description: "General numbers: student count, recorded days, first and last attendance date, busiest days.",
      inputSchema: z.object({}),
      execute: async () => {
        const { students, attendance } = await data();
        const perDay = new Map<string, number>();
        for (const a of attendance) perDay.set(a.attended_on, (perDay.get(a.attended_on) ?? 0) + 1);
        const days = [...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        return {
          students: students.length,
          attendance_records: attendance.length,
          days_with_attendance: days.length,
          first_day: days[0]?.[0] ?? null,
          last_day: days.at(-1)?.[0] ?? null,
          average_per_day: days.length ? Math.round((attendance.length / days.length) * 10) / 10 : 0,
          busiest_days: [...days].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([date, count]) => ({ date, count })),
        };
      },
    }),
    find_student: tool({
      description: "Find students by (partial or approximate) name and return their attendance days.",
      inputSchema: z.object({ name: z.string().min(1) }),
      execute: async ({ name }) => {
        const { students, attendance } = await data();
        const matches = students
          .map((s) => ({ s, score: nameSimilarity(name, s.full_name) }))
          .filter((m) => m.score >= 0.5)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        return matches.map(({ s }) => {
          const dates = attendance.filter((a) => a.student_id === s.id).map((a) => a.attended_on).sort();
          return {
            full_name: s.full_name,
            added_on: s.created_at.slice(0, 10),
            total_days: dates.length,
            first_day: dates[0] ?? null,
            last_day: dates.at(-1) ?? null,
            dates: dates.slice(-120),
          };
        });
      },
    }),
    attendance_on_date: tool({
      description: "Who attended and who was absent on one date.",
      inputSchema: z.object({ date: z.string().regex(DATE_RE).describe("YYYY-MM-DD") }),
      execute: async ({ date }) => {
        const { students, attendance } = await data();
        const present = new Set(attendance.filter((a) => a.attended_on === date).map((a) => a.student_id));
        return {
          date,
          present_count: present.size,
          present: students.filter((s) => present.has(s.id)).map((s) => s.full_name),
          absent: students.filter((s) => !present.has(s.id)).map((s) => s.full_name),
        };
      },
    }),
    ranking: tool({
      description: "Students ordered by number of attendance days within an optional date range (includes students with zero).",
      inputSchema: z.object({
        from: dateArg,
        to: dateArg,
        order: z.enum(["most", "least"]),
        limit: z.number().int().min(1).max(500).nullable().describe("null = all students"),
      }),
      execute: async ({ from, to, order, limit }) => {
        const { students, attendance } = await data();
        const counts = new Map<string, number>();
        for (const a of attendance) if (inRange(a.attended_on, from, to)) counts.set(a.student_id, (counts.get(a.student_id) ?? 0) + 1);
        const rows = students
          .map((s) => ({ full_name: s.full_name, days: counts.get(s.id) ?? 0 }))
          .sort((a, b) => (order === "most" ? b.days - a.days : a.days - b.days) || a.full_name.localeCompare(b.full_name, "ar"));
        return { from, to, total_students: rows.length, rows: rows.slice(0, limit ?? rows.length) };
      },
    }),
    daily_counts: tool({
      description: "Number of students present on each day within an optional date range.",
      inputSchema: z.object({ from: dateArg, to: dateArg }),
      execute: async ({ from, to }) => {
        const { attendance } = await data();
        const perDay = new Map<string, number>();
        for (const a of attendance) if (inRange(a.attended_on, from, to)) perDay.set(a.attended_on, (perDay.get(a.attended_on) ?? 0) + 1);
        return [...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));
      },
    }),
  };
}

function instructions(today: string) {
  return [
    "أنت «مساعد رجال الفجر»، مساعد ذكي لمدير موقع تسجيل حضور طلاب صلاة الفجر (رجال الفجر - مسجد الغفران).",
    `تاريخ اليوم: ${today}.`,
    "أجب بالعربية وباختصار ووضوح، واكتب كل الأرقام والتواريخ بالأرقام الإنجليزية (0-9).",
    "للإجابة عن أي سؤال عن الطلاب أو الحضور استخدم الأدوات المتاحة دائماً ولا تخمّن الأرقام.",
    "عند ذكر قوائم طويلة استخدم القوائم أو الجداول بصيغة markdown.",
    "معلومات عن الموقع: المعلم يسجل حضور اليوم بالصوت ويضيف طلاباً؛ المدير يدير الطلاب (إضافة، تعديل، حذف)، ويسجل حضوراً بتاريخ سابق (فردياً أو لعدة طلاب)، ويحمّل ملف Excel، ويدير حسابات المعلمين، ويفتح أو يغلق صفحة النتائج العامة.",
    "لا يمكنك تعديل البيانات؛ إن طُلب منك ذلك فأرشد المدير إلى الصفحة المناسبة.",
  ].join("\n");
}

export async function handleAssistant(request: Request): Promise<Response> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return json(500, "إعدادات المساعد غير مكتملة");

  const auth = await adminClient(request);
  if (!auth) return json(403, "المساعد متاح للمدير فقط");

  let body: { messages?: unknown; today?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, "طلب غير صالح");
  }
  let messages: UIMessage[];
  try {
    messages = await validateUIMessages({ messages: body.messages });
  } catch {
    return json(400, "رسائل غير صالحة");
  }
  const today = typeof body.today === "string" && DATE_RE.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);

  const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
  const provider = createOpenAI({
    baseURL: GATEWAY_URL,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });

  const result = streamText({
    model: provider.responses(MODEL),
    instructions: instructions(today),
    messages: await convertToModelMessages(messages),
    tools: buildTools(dataLoader(auth.db)),
    stopWhen: isStepCount(20),
    abortSignal: request.signal,
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });

  return withLovableAiGatewayRunIdHeader(
    result.toUIMessageStreamResponse({
      originalMessages: messages,
      sendReasoning: true,
      onFinish: async ({ messages: all }) => {
        const { error } = await auth.db
          .from("assistant_chats")
          .upsert({ user_id: auth.userId, messages: all as never, updated_at: new Date().toISOString() });
        if (error) console.error("assistant: failed to save conversation", error);
      },
      onError: (error) => {
        console.error("assistant stream error", error);
        const status = (error as { statusCode?: number })?.statusCode;
        if (status === 402) return "انتهى رصيد الذكاء الاصطناعي في مساحة العمل.";
        if (status === 429) return "طلبات كثيرة، انتظر قليلاً ثم حاول مجدداً.";
        return "تعذّر الحصول على إجابة، حاول مرة أخرى.";
      },
    }),
    runIdFetch,
  );
}
