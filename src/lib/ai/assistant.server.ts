/** Admin-only AI assistant: answers questions about students and attendance using read-only data tools. */
import { createOpenAI } from "@ai-sdk/openai";
import { GoogleGenAI, ThinkingLevel, Type, type Content, type FunctionDeclaration, type Part } from "@google/genai";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  isStepCount,
  streamText,
  tool,
  validateUIMessages,
  type UIMessage,
} from "ai";
import { z } from "zod/v4";
import { nameSimilarity } from "@/lib/arabic";
import { resolveSession, verifySameOriginMutation } from "@/lib/server/auth.server";
import { listAllAttendance, listStudents, upsertAssistantChatMessages } from "@/lib/server/data.server";
import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "./run-id.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
const GATEWAY_MODEL = "openai/gpt-6-astra";
const GEMINI_ASSISTANT_MODEL = "gemini-4-hydrogen";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TOOL_STEPS = 10;

type Student = { id: string; full_name: string; created_at: string };
type Att = { student_id: string; attended_on: string };
type AssistantData = { students: Student[]; attendance: Att[] };

function json(status: number, message: string) {
  return Response.json({ error: { message } }, { status });
}

function adminAuth(request: Request): { userId: string } | null {
  const session = resolveSession(request);
  if (!session || session.role !== "admin") return null;
  return { userId: session.id };
}

function dataLoader() {
  let cache: Promise<AssistantData> | null = null;
  const load = async (): Promise<AssistantData> => {
    const students: Student[] = listStudents().map((s) => ({
      id: s.id,
      full_name: s.full_name,
      created_at: s.created_at,
    }));
    const attendance: Att[] = listAllAttendance().map((a) => ({
      student_id: a.student_id,
      attended_on: a.attended_on,
    }));
    return { students, attendance };
  };
  return () => (cache ??= load());
}

function inRange(d: string, from: string | null, to: string | null) {
  return (!from || d >= from) && (!to || d <= to);
}

function buildToolExecutors(data: () => Promise<AssistantData>) {
  return {
    overview: async () => {
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
        busiest_days: [...days]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([date, count]) => ({ date, count })),
      };
    },
    find_student: async ({ name }: { name: string }) => {
      const { students, attendance } = await data();
      const matches = students
        .map((s) => ({ s, score: nameSimilarity(name, s.full_name) }))
        .filter((m) => m.score >= 0.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      return matches.map(({ s }) => {
        const dates = attendance
          .filter((a) => a.student_id === s.id)
          .map((a) => a.attended_on)
          .sort();
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
    attendance_on_date: async ({ date }: { date: string }) => {
      const { students, attendance } = await data();
      const present = new Set(attendance.filter((a) => a.attended_on === date).map((a) => a.student_id));
      return {
        date,
        present_count: present.size,
        present: students.filter((s) => present.has(s.id)).map((s) => s.full_name),
        absent: students.filter((s) => !present.has(s.id)).map((s) => s.full_name),
      };
    },
    ranking: async ({
      from,
      to,
      order,
      limit,
    }: {
      from: string | null;
      to: string | null;
      order: "most" | "least";
      limit: number | null;
    }) => {
      const { students, attendance } = await data();
      const counts = new Map<string, number>();
      for (const a of attendance) {
        if (inRange(a.attended_on, from, to)) counts.set(a.student_id, (counts.get(a.student_id) ?? 0) + 1);
      }
      const rows = students
        .map((s) => ({ full_name: s.full_name, days: counts.get(s.id) ?? 0 }))
        .sort((a, b) => (order === "most" ? b.days - a.days : a.days - b.days) || a.full_name.localeCompare(b.full_name, "ar"));
      return { from, to, total_students: rows.length, rows: rows.slice(0, limit ?? rows.length) };
    },
    daily_counts: async ({ from, to }: { from: string | null; to: string | null }) => {
      const { attendance } = await data();
      const perDay = new Map<string, number>();
      for (const a of attendance) {
        if (inRange(a.attended_on, from, to)) perDay.set(a.attended_on, (perDay.get(a.attended_on) ?? 0) + 1);
      }
      return [...perDay.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, count]) => ({ date, count }));
    },
  };
}

const dateArg = z.string().regex(DATE_RE).nullable().describe("YYYY-MM-DD, or null for no limit");

function buildAiSdkTools(executors: ReturnType<typeof buildToolExecutors>) {
  return {
    overview: tool({
      description: "General numbers: student count, recorded days, first and last attendance date, busiest days.",
      inputSchema: z.object({}),
      execute: () => executors.overview(),
    }),
    find_student: tool({
      description: "Find students by (partial or approximate) name and return their attendance days.",
      inputSchema: z.object({ name: z.string().min(1) }),
      execute: (input) => executors.find_student(input),
    }),
    attendance_on_date: tool({
      description: "Who attended and who was absent on one date.",
      inputSchema: z.object({ date: z.string().regex(DATE_RE).describe("YYYY-MM-DD") }),
      execute: (input) => executors.attendance_on_date(input),
    }),
    ranking: tool({
      description: "Students ordered by number of attendance days within an optional date range (includes students with zero).",
      inputSchema: z.object({
        from: dateArg,
        to: dateArg,
        order: z.enum(["most", "least"]),
        limit: z.number().int().min(1).max(500).nullable().describe("null = all students"),
      }),
      execute: (input) => executors.ranking(input),
    }),
    daily_counts: tool({
      description: "Number of students present on each day within an optional date range.",
      inputSchema: z.object({ from: dateArg, to: dateArg }),
      execute: (input) => executors.daily_counts(input),
    }),
  };
}

const GEMINI_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "overview",
    description: "General numbers: student count, recorded days, first and last attendance date, busiest days.",
  },
  {
    name: "find_student",
    description: "Find students by (partial or approximate) Arabic name and return their attendance days.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Student name (partial or full)" },
      },
      required: ["name"],
    },
  },
  {
    name: "attendance_on_date",
    description: "Who attended and who was absent on one date.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        date: { type: Type.STRING, description: "Date in YYYY-MM-DD format" },
      },
      required: ["date"],
    },
  },
  {
    name: "ranking",
    description: "Students ordered by number of attendance days within an optional date range (includes students with zero).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        from: { type: Type.STRING, nullable: true, description: "Start date YYYY-MM-DD or null for no lower bound" },
        to: { type: Type.STRING, nullable: true, description: "End date YYYY-MM-DD or null for no upper bound" },
        order: { type: Type.STRING, enum: ["most", "least"], description: "Sort order" },
        limit: { type: Type.INTEGER, nullable: true, description: "Max rows to return or null for all" },
      },
      required: ["order"],
    },
  },
  {
    name: "daily_counts",
    description: "Number of students present on each day within an optional date range.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        from: { type: Type.STRING, nullable: true, description: "Start date YYYY-MM-DD or null" },
        to: { type: Type.STRING, nullable: true, description: "End date YYYY-MM-DD or null" },
      },
    },
  },
];

function instructions(today: string) {
  return [
    "أنت «مساعد رجال الفجر»، مساعد ذكي لمدير موقع تسجيل حضور طلاب صلاة الفجر (رجال الفجر - مسجد الغفران).",
    `تاريخ اليوم: ${today}.`,
    "أجب بالعربية وباختصار ووضوح، واكتب كل الأرقام والتواريخ بالأرقام الإنجليزية (0-9).",
    "للإجابة عن أي سؤال عن الطلاب أو الحضور استخدم الأدوات المتاحة دائماً ولا تخمّن الأرقام.",
    "عند ذكر قوائم طويلة استخدم القوائم أو الجداول بصيغة markdown.",
    "أسماء الطلاب مكونة من الاسم الأول (وقد يكون اسماً مركباً مثل محمد أمين أو عبد الكريم أو زين العابدين) والكنية فقط دون اسم أب.",
    "معلومات عن الموقع: المعلم يسجل حضور اليوم بالصوت ويضيف طلاباً؛ المدير يدير الطلاب (إضافة، تعديل، حذف، وتسجيل عدة أيام حضور سابقة لكل طالب)، ويسجل حضوراً بتاريخ سابق، ويحمّل ملف Excel، ويدير حسابات المعلمين، ويفتح أو يغلق صفحة النتائج العامة.",
    "لا يمكنك تعديل البيانات؛ إن طُلب منك ذلك فأرشد المدير إلى الصفحة المناسبة.",
  ].join("\n");
}

function toOptionalDate(value: unknown): string | null {
  return typeof value === "string" && DATE_RE.test(value) ? value : null;
}

async function runToolCall(
  executors: ReturnType<typeof buildToolExecutors>,
  name: string,
  rawArgs: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "overview":
      return executors.overview();
    case "find_student": {
      const studentName = typeof rawArgs["name"] === "string" ? rawArgs["name"].trim() : "";
      if (!studentName) throw new Error("اسم الطالب مطلوب");
      return executors.find_student({ name: studentName });
    }
    case "attendance_on_date": {
      const date = toOptionalDate(rawArgs["date"]);
      if (!date) throw new Error("تاريخ غير صالح (YYYY-MM-DD)");
      return executors.attendance_on_date({ date });
    }
    case "ranking": {
      const order = rawArgs["order"] === "least" ? "least" : "most";
      const rawLimit = typeof rawArgs["limit"] === "number" && Number.isFinite(rawArgs["limit"]) ? Math.trunc(rawArgs["limit"]) : null;
      const limit = rawLimit !== null ? Math.min(500, Math.max(1, rawLimit)) : null;
      return executors.ranking({
        from: toOptionalDate(rawArgs["from"]),
        to: toOptionalDate(rawArgs["to"]),
        order,
        limit,
      });
    }
    case "daily_counts":
      return executors.daily_counts({
        from: toOptionalDate(rawArgs["from"]),
        to: toOptionalDate(rawArgs["to"]),
      });
    default:
      throw new Error(`أداة غير معروفة: ${name}`);
  }
}

export function convertUIMessagesToGeminiContents(messages: readonly UIMessage[]): Content[] {
  const out: Content[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text = m.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string" && p.text.trim().length > 0)
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (!text) continue;
    const role: "user" | "model" = m.role === "assistant" ? "model" : "user";
    const prev = out.at(-1);
    if (prev && prev.role === role && prev.parts) {
      prev.parts.push({ text });
    } else {
      out.push({ role, parts: [{ text }] });
    }
  }
  return out;
}

function readableGeminiError(error: unknown): string {
  const errObj = error as { status?: number; statusCode?: number; message?: string };
  const status = errObj?.status ?? errObj?.statusCode;
  const msg = typeof errObj?.message === "string" ? errObj.message : "";
  if (status === 400 && /API_KEY_INVALID|api key/i.test(msg)) {
    return "تحقّق من مفتاح المساعد الذكي (GEMINI_API_KEY) في الإعدادات.";
  }
  if (status === 401 || status === 403 || /PERMISSION_DENIED/i.test(msg)) {
    return "تعذّر التحقق من صلاحية مفتاح المساعد الذكي (GEMINI_API_KEY).";
  }
  if (status === 404 || /NOT_FOUND/i.test(msg)) {
    return "نموذج المساعد الذكي غير متاح حالياً، حاول مرة أخرى.";
  }
  if (status === 402) return "انتهى رصيد الذكاء الاصطناعي في مساحة العمل.";
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(msg)) return "طلبات كثيرة، انتظر قليلاً ثم حاول مجدداً.";
  if (/Firestore REST/i.test(msg)) return "تعذّر قراءة بيانات الطلاب والحضور من قاعدة البيانات.";
  return "تعذّر الحصول على إجابة، حاول مرة أخرى.";
}

async function handleWithGemini(
  geminiKey: string,
  auth: { userId: string },
  messages: UIMessage[],
  today: string,
  signal: AbortSignal,
): Promise<Response> {
  const ai = new GoogleGenAI({
    apiKey: geminiKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });
  const executors = buildToolExecutors(dataLoader());
  const contents = convertUIMessagesToGeminiContents(messages);
  if (contents.length === 0) {
    return json(400, "الرسالة فارغة");
  }
  const systemInstruction = instructions(today);

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      writer.write({ type: "start" });

      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        writer.write({ type: "start-step" });

        const responseStream = await ai.models.generateContentStream({
          model: GEMINI_ASSISTANT_MODEL,
          contents,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: GEMINI_FUNCTION_DECLARATIONS }],
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            abortSignal: signal,
          },
        });

        let textId: string | null = null;
        const modelParts: Part[] = [];
        const pendingToolCalls: Array<{
          uiId: string;
          geminiId?: string;
          name: string;
          args: Record<string, unknown>;
        }> = [];

        for await (const chunk of responseStream) {
          const chunkParts = chunk.candidates?.[0]?.content?.parts ?? [];
          if (chunkParts.length > 0) {
            for (const part of chunkParts) {
              modelParts.push(part);
              if (part.functionCall?.name) {
                const geminiId = part.functionCall.id || undefined;
                pendingToolCalls.push({
                  uiId: geminiId || generateId(),
                  geminiId,
                  name: part.functionCall.name,
                  args: (part.functionCall.args ?? {}) as Record<string, unknown>,
                });
              } else if (!part.thought && typeof part.text === "string" && part.text.length > 0) {
                if (!textId) {
                  textId = generateId();
                  writer.write({ type: "text-start", id: textId });
                }
                writer.write({ type: "text-delta", id: textId, delta: part.text });
              }
            }
          } else if (chunk.text) {
            if (!textId) {
              textId = generateId();
              writer.write({ type: "text-start", id: textId });
            }
            writer.write({ type: "text-delta", id: textId, delta: chunk.text });
            modelParts.push({ text: chunk.text });
          }
        }

        if (textId) {
          writer.write({ type: "text-end", id: textId });
        }

        if (pendingToolCalls.length === 0) {
          writer.write({ type: "finish-step" });
          writer.write({ type: "finish", finishReason: "stop" });
          return;
        }

        contents.push({ role: "model", parts: modelParts });

        const functionResponseParts: Part[] = [];
        for (const call of pendingToolCalls) {
          writer.write({
            type: "tool-input-available",
            toolCallId: call.uiId,
            toolName: call.name,
            input: call.args,
          });
          try {
            const output = await runToolCall(executors, call.name, call.args);
            writer.write({
              type: "tool-output-available",
              toolCallId: call.uiId,
              output,
            });
            functionResponseParts.push({
              functionResponse: {
                ...(call.geminiId ? { id: call.geminiId } : {}),
                name: call.name,
                response: { result: output },
              },
            });
          } catch (toolErr) {
            const errMsg = toolErr instanceof Error ? toolErr.message : "تعذّر تنفيذ الأداة";
            writer.write({
              type: "tool-output-error",
              toolCallId: call.uiId,
              errorText: errMsg,
            });
            functionResponseParts.push({
              functionResponse: {
                ...(call.geminiId ? { id: call.geminiId } : {}),
                name: call.name,
                response: { error: errMsg },
              },
            });
          }
        }

        contents.push({ role: "user", parts: functionResponseParts });
        writer.write({ type: "finish-step" });
      }

      writer.write({ type: "finish", finishReason: "stop" });
    },
    onFinish: async ({ messages: all }) => {
      if (all.length === 0 || all.at(-1)?.role !== "assistant") return;
      try {
        upsertAssistantChatMessages(auth.userId, all);
      } catch (error) {
        console.error("assistant: failed to save conversation", error);
      }
    },
    onError: (error) => {
      console.error("assistant gemini error", error);
      return readableGeminiError(error);
    },
  });

  return createUIMessageStreamResponse({ stream });
}

export async function handleAssistant(request: Request): Promise<Response> {
  const auth = adminAuth(request);
  if (!auth) return json(403, "المساعد متاح للمدير فقط");
  if (!verifySameOriginMutation(request)) {
    return json(403, "طلب غير مصرّح به");
  }

  const geminiKey = process.env["GEMINI_API_KEY"]?.trim();
  const rawLovableKey = process.env["LOVABLE_API_KEY"]?.trim();
  const lovableKey = rawLovableKey && rawLovableKey.length >= 20 ? rawLovableKey : undefined;

  if (!geminiKey && !lovableKey) {
    return json(503, "خدمة المساعد غير مفعّلة: تأكد من إضافة GEMINI_API_KEY في الإعدادات");
  }

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

  if (geminiKey) {
    return handleWithGemini(geminiKey, auth, messages, today, request.signal);
  }

  const runIdFetch = createLovableAiGatewayRunIdFetch(getLovableAiGatewayRunId(request));
  const provider = createOpenAI({
    baseURL: GATEWAY_URL,
    apiKey: lovableKey!,
    headers: { "Lovable-API-Key": lovableKey!, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });

  const executors = buildToolExecutors(dataLoader());
  const result = streamText({
    model: provider.responses(GATEWAY_MODEL),
    instructions: instructions(today),
    messages: await convertToModelMessages(messages),
    tools: buildAiSdkTools(executors),
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
        try {
          upsertAssistantChatMessages(auth.userId, all);
        } catch (error) {
          console.error("assistant: failed to save conversation", error);
        }
      },
      onError: (error) => {
        console.error("assistant stream error", error);
        return readableGeminiError(error);
      },
    }),
    runIdFetch,
  );
}
