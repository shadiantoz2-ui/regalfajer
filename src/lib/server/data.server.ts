import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import {
  computePublicLeaderboard,
  normalizePastAttendanceDates,
  STAFF_LIMITS,
  validateStudentDisplayName,
} from "@/lib/firebase/domain";
import type { AttendanceRow, StaffRecordingItem, StaffSessionUser, Student } from "@/lib/types";
import { appSettings, attendance, students } from "../../db/schema.ts";
import { ensureInitialDataSeeded, getDb } from "./db.server";
import { createSingleflight, TtlCache } from "./request-cache";

const dataSf = createSingleflight();
const leaderboardCache = new TtlCache<{ open: boolean; rows: { full_name: string; days: number }[] }>(10_000, 4);
const settingsPublicCache = new TtlCache<boolean>(10_000, 4);
const settingsEntryCache = new TtlCache<boolean>(2_000, 4);

function invalidateLeaderboardCaches() {
  leaderboardCache.clear();
}

export type DayRow = {
  id: string;
  student_id: string;
  full_name: string;
  created_at: string;
};

export async function listStudents(): Promise<Student[]> {
  return dataSf.run("students:list", async () => {
    await ensureInitialDataSeeded();
    try {
      const db = getDb();
      const rows = await db
        .select({
          id: students.id,
          full_name: students.fullName,
          created_at: students.createdAt,
        })
        .from(students);
      return rows.sort((a, b) => a.full_name.localeCompare(b.full_name, "ar"));
    } catch (error) {
      console.error("Failed to list students:", error);
      throw new Error("تعذّر تحميل قائمة الطلاب", { cause: error });
    }
  });
}

export async function addStudent(
  rawName: string,
  actorId: string,
): Promise<
  | { status: "created"; student: Student }
  | { status: "duplicate"; existing: string; student: Student }
  | { status: "invalid" }
> {
  await ensureInitialDataSeeded();
  const { valid, full_name, normalized_name } = validateStudentDisplayName(rawName);
  if (!valid) return { status: "invalid" };

  try {
    const db = getDb();
    const existingRows = await db
      .select({
        id: students.id,
        full_name: students.fullName,
        created_at: students.createdAt,
      })
      .from(students)
      .where(eq(students.normalizedName, normalized_name))
      .limit(1);

    const existing = existingRows[0];
    if (existing) {
      return { status: "duplicate", existing: existing.full_name, student: existing };
    }

    const id = randomUUID();
    const nowIso = new Date().toISOString();
    await db.insert(students).values({
      id,
      fullName: full_name,
      normalizedName: normalized_name,
      createdById: actorId,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    invalidateLeaderboardCaches();
    return { status: "created", student: { id, full_name, created_at: nowIso } };
  } catch (error) {
    console.error("Failed to add student:", error);
    throw new Error("تعذّر إضافة الطالب", { cause: error });
  }
}

export async function addStudentsBulk(
  rawNames: readonly string[],
  actorId: string,
): Promise<{ created: Student[]; duplicates: string[] }> {
  await ensureInitialDataSeeded();
  const deduped = new Map<string, string>();
  for (const raw of rawNames) {
    const { valid, full_name, normalized_name } = validateStudentDisplayName(raw);
    if (!valid) continue;
    if (!deduped.has(normalized_name)) {
      deduped.set(normalized_name, full_name);
    }
  }
  if (deduped.size === 0) {
    return { created: [], duplicates: [] };
  }

  try {
    const db = getDb();
    const normKeys = Array.from(deduped.keys());
    const existingRows = await db
      .select({ normalizedName: students.normalizedName })
      .from(students)
      .where(inArray(students.normalizedName, normKeys));

    const existingSet = new Set(existingRows.map((r) => r.normalizedName));
    const duplicates: string[] = [];
    const toInsert: Array<typeof students.$inferInsert> = [];
    const createdStudents: Student[] = [];
    const nowIso = new Date().toISOString();

    for (const [norm, fullName] of deduped.entries()) {
      if (existingSet.has(norm)) {
        duplicates.push(fullName);
        continue;
      }
      const id = randomUUID();
      toInsert.push({
        id,
        fullName,
        normalizedName: norm,
        createdById: actorId,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      createdStudents.push({ id, full_name: fullName, created_at: nowIso });
    }

    if (toInsert.length > 0) {
      await db.insert(students).values(toInsert).onConflictDoNothing({
        target: students.normalizedName,
      });
      invalidateLeaderboardCaches();
    }

    return { created: createdStudents, duplicates };
  } catch (error) {
    console.error("Failed to add students in bulk:", error);
    throw new Error("تعذّر إضافة قائمة الطلاب", { cause: error });
  }
}

export async function renameStudent(
  id: string,
  rawName: string,
): Promise<{ status: "renamed" } | { status: "duplicate"; existing: string } | { status: "invalid" }> {
  await ensureInitialDataSeeded();
  const { valid, full_name, normalized_name } = validateStudentDisplayName(rawName);
  if (!valid || !id) return { status: "invalid" };

  try {
    const db = getDb();
    const existingRows = await db
      .select({ id: students.id, full_name: students.fullName })
      .from(students)
      .where(eq(students.normalizedName, normalized_name))
      .limit(1);

    const existing = existingRows[0];
    if (existing && existing.id !== id) {
      return { status: "duplicate", existing: existing.full_name };
    }

    const target = await db
      .select({ id: students.id })
      .from(students)
      .where(eq(students.id, id))
      .limit(1);
    if (target.length === 0) return { status: "invalid" };

    const nowIso = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx
        .update(students)
        .set({
          fullName: full_name,
          normalizedName: normalized_name,
          updatedAt: nowIso,
        })
        .where(eq(students.id, id));

      await tx
        .update(attendance)
        .set({ studentName: full_name })
        .where(eq(attendance.studentId, id));
    });

    invalidateLeaderboardCaches();
    return { status: "renamed" };
  } catch (error) {
    console.error("Failed to rename student:", error);
    throw new Error("تعذّر تعديل اسم الطالب", { cause: error });
  }
}

export async function deleteStudent(id: string): Promise<boolean> {
  await ensureInitialDataSeeded();
  try {
    const db = getDb();
    const deleted = await db
      .delete(students)
      .where(eq(students.id, id))
      .returning({ id: students.id });
    if (deleted.length > 0) invalidateLeaderboardCaches();
    return deleted.length > 0;
  } catch (error) {
    console.error("Failed to delete student:", error);
    throw new Error("تعذّر حذف الطالب", { cause: error });
  }
}

export async function listDayAttendance(date: string): Promise<DayRow[]> {
  if (!STAFF_LIMITS.DATE_PATTERN.test(date)) return [];
  return dataSf.run(`attendance:day:${date}`, async () => {
    await ensureInitialDataSeeded();
    try {
      const db = getDb();
      return await db
        .select({
          id: attendance.id,
          student_id: attendance.studentId,
          full_name: attendance.studentName,
          created_at: attendance.createdAt,
        })
        .from(attendance)
        .where(eq(attendance.attendedOn, date))
        .orderBy(desc(attendance.createdAt));
    } catch (error) {
      console.error("Failed to list day attendance:", error);
      throw new Error("تعذّر تحميل حضور اليوم", { cause: error });
    }
  });
}

export async function listStudentAttendance(studentId: string): Promise<AttendanceRow[]> {
  if (!studentId) return [];
  await ensureInitialDataSeeded();
  try {
    const db = getDb();
    return await db
      .select({
        id: attendance.id,
        student_id: attendance.studentId,
        attended_on: attendance.attendedOn,
        created_at: attendance.createdAt,
      })
      .from(attendance)
      .where(eq(attendance.studentId, studentId))
      .orderBy(desc(attendance.attendedOn));
  } catch (error) {
    console.error("Failed to list student attendance:", error);
    throw new Error("تعذّر تحميل سجل حضور الطالب", { cause: error });
  }
}

export async function listAllAttendance(from?: string, to?: string): Promise<AttendanceRow[]> {
  await ensureInitialDataSeeded();
  try {
    const db = getDb();
    const filters: SQL[] = [];
    if (from && STAFF_LIMITS.DATE_PATTERN.test(from)) {
      filters.push(gte(attendance.attendedOn, from));
    }
    if (to && STAFF_LIMITS.DATE_PATTERN.test(to)) {
      filters.push(lte(attendance.attendedOn, to));
    }

    const baseQuery = db
      .select({
        id: attendance.id,
        student_id: attendance.studentId,
        attended_on: attendance.attendedOn,
        created_at: attendance.createdAt,
      })
      .from(attendance);

    if (filters.length > 0) {
      return await baseQuery.where(and(...filters)).orderBy(asc(attendance.attendedOn), asc(attendance.createdAt));
    }
    return await baseQuery.orderBy(asc(attendance.attendedOn), asc(attendance.createdAt));
  } catch (error) {
    console.error("Failed to list all attendance:", error);
    throw new Error("تعذّر تحميل سجلات الحضور", { cause: error });
  }
}

export async function listStaffDayRecordings(staffId: string, date: string): Promise<StaffRecordingItem[]> {
  if (!staffId || !STAFF_LIMITS.DATE_PATTERN.test(date)) return [];
  return dataSf.run(`attendance:staff:${staffId}:${date}`, async () => {
    await ensureInitialDataSeeded();
    try {
      const db = getDb();
      return await db
        .select({
          id: attendance.id,
          teacherId: attendance.recordedById,
          teacherUsername: attendance.recordedByUsername,
          teacherName: attendance.recordedByName,
          studentId: attendance.studentId,
          studentName: attendance.studentName,
          attendedOn: attendance.attendedOn,
          recordedAt: attendance.createdAt,
        })
        .from(attendance)
        .where(and(eq(attendance.recordedById, staffId), eq(attendance.attendedOn, date)))
        .orderBy(desc(attendance.createdAt));
    } catch (error) {
      console.error("Failed to list staff day recordings:", error);
      throw new Error("تعذّر تحميل تسجيلات الحضور", { cause: error });
    }
  });
}

export async function recordAttendance(
  studentId: string,
  attendedOn: string,
  actor: StaffSessionUser,
): Promise<{ status: "recorded" | "duplicate" | "not_found" }> {
  if (!STAFF_LIMITS.DATE_PATTERN.test(attendedOn)) {
    throw new Error("تاريخ غير صالح");
  }
  await ensureInitialDataSeeded();

  try {
    const db = getDb();
    const nowIso = new Date().toISOString();
    const res = await db.execute<{ found_count: number; inserted_count: number }>(sql`
      WITH target AS (
        SELECT ${students.id} AS id, ${students.fullName} AS full_name
        FROM ${students}
        WHERE ${students.id} = ${studentId}
        LIMIT 1
      ),
      ins AS (
        INSERT INTO ${attendance} (
          id, student_id, student_name, attended_on,
          recorded_by_id, recorded_by_name, recorded_by_username, created_at
        )
        SELECT
          ${attendedOn} || '_' || target.id,
          target.id,
          target.full_name,
          ${attendedOn},
          ${actor.id},
          ${actor.name},
          ${actor.username},
          ${nowIso}
        FROM target
        ON CONFLICT (student_id, attended_on) DO NOTHING
        RETURNING id
      )
      SELECT
        (SELECT count(*)::int FROM target) AS found_count,
        (SELECT count(*)::int FROM ins) AS inserted_count
    `);

    const row = res.rows[0];
    if (!row || Number(row.found_count) === 0) return { status: "not_found" };
    if (Number(row.inserted_count) > 0) {
      invalidateLeaderboardCaches();
      return { status: "recorded" };
    }
    return { status: "duplicate" };
  } catch (error) {
    console.error("Failed to record attendance:", error);
    throw new Error("تعذّر تسجيل الحضور", { cause: error });
  }
}

export async function recordAttendanceBulk(
  studentIds: readonly string[],
  attendedOn: string,
  actor: StaffSessionUser,
): Promise<{ recorded: number; skipped: number }> {
  if (!STAFF_LIMITS.DATE_PATTERN.test(attendedOn)) {
    throw new Error("تاريخ غير صالح");
  }
  const uniqueIds = Array.from(new Set(studentIds.filter(Boolean)));
  if (!uniqueIds.length) return { recorded: 0, skipped: 0 };

  await ensureInitialDataSeeded();

  try {
    const db = getDb();
    const foundStudents = await db
      .select({ id: students.id, fullName: students.fullName })
      .from(students)
      .where(inArray(students.id, uniqueIds));

    const studentMap = new Map(foundStudents.map((s) => [s.id, s.fullName]));
    const nowIso = new Date().toISOString();

    const toInsert: Array<typeof attendance.$inferInsert> = [];
    let missingCount = 0;
    for (const studentId of uniqueIds) {
      const fullName = studentMap.get(studentId);
      if (!fullName) {
        missingCount += 1;
        continue;
      }
      toInsert.push({
        id: `${attendedOn}_${studentId}`,
        studentId,
        studentName: fullName,
        attendedOn,
        recordedById: actor.id,
        recordedByName: actor.name,
        recordedByUsername: actor.username,
        createdAt: nowIso,
      });
    }

    if (toInsert.length === 0) {
      return { recorded: 0, skipped: uniqueIds.length };
    }

    const inserted = await db
      .insert(attendance)
      .values(toInsert)
      .onConflictDoNothing()
      .returning({ id: attendance.id });

    const recorded = inserted.length;
    if (recorded > 0) invalidateLeaderboardCaches();
    const skipped = missingCount + (toInsert.length - recorded);
    return { recorded, skipped };
  } catch (error) {
    console.error("Failed to record bulk attendance:", error);
    throw new Error("تعذّر تسجيل الحضور الجماعي", { cause: error });
  }
}

export async function recordStudentPastDates(
  studentId: string,
  dates: readonly string[],
  maxDate: string,
  actor: StaffSessionUser,
): Promise<{ recorded: number; skipped: number }> {
  await ensureInitialDataSeeded();
  try {
    const db = getDb();
    const studentRows = await db
      .select({ id: students.id, fullName: students.fullName })
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);

    const student = studentRows[0];
    if (!student) {
      throw new Error("الطالب غير موجود");
    }

    const existing = await db
      .select({ attendedOn: attendance.attendedOn })
      .from(attendance)
      .where(eq(attendance.studentId, student.id));

    const existingSet = new Set(existing.map((r) => r.attendedOn));
    const { validDates, skippedCount } = normalizePastAttendanceDates(dates, maxDate, existingSet);
    if (!validDates.length) return { recorded: 0, skipped: skippedCount };

    const nowIso = new Date().toISOString();
    const values: Array<typeof attendance.$inferInsert> = validDates.map((attendedOn) => ({
      id: `${attendedOn}_${student.id}`,
      studentId: student.id,
      studentName: student.fullName,
      attendedOn,
      recordedById: actor.id,
      recordedByName: actor.name,
      recordedByUsername: actor.username,
      createdAt: nowIso,
    }));

    const inserted = await db
      .insert(attendance)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: attendance.id });

    if (inserted.length > 0) invalidateLeaderboardCaches();
    return { recorded: inserted.length, skipped: skippedCount + (values.length - inserted.length) };
  } catch (error) {
    if (error instanceof Error && error.message === "الطالب غير موجود") {
      throw error;
    }
    console.error("Failed to record student past dates:", error);
    throw new Error("تعذّر تسجيل الأيام السابقة", { cause: error });
  }
}

export async function deleteAttendance(id: string): Promise<boolean> {
  await ensureInitialDataSeeded();
  try {
    const db = getDb();
    const deleted = await db
      .delete(attendance)
      .where(eq(attendance.id, id))
      .returning({ id: attendance.id });
    if (deleted.length > 0) invalidateLeaderboardCaches();
    return deleted.length > 0;
  } catch (error) {
    console.error("Failed to delete attendance:", error);
    throw new Error("تعذّر إلغاء سجل الحضور", { cause: error });
  }
}

export async function getResultsPublic(): Promise<boolean> {
  const cached = settingsPublicCache.get("results_public");
  if (cached !== undefined) return cached;

  return dataSf.run("settings:results_public", async () => {
    await ensureInitialDataSeeded();
    try {
      const db = getDb();
      const rows = await db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, "results_public"))
        .limit(1);
      const val = rows[0]?.value === "true";
      settingsPublicCache.set("results_public", val);
      return val;
    } catch (error) {
      console.error("Failed to read results_public setting:", error);
      throw new Error("تعذّر قراءة إعدادات النتائج", { cause: error });
    }
  });
}

export async function setResultsPublic(value: boolean, actorId: string): Promise<void> {
  await ensureInitialDataSeeded();
  try {
    const db = getDb();
    const nowIso = new Date().toISOString();
    const serialized = value ? "true" : "false";
    await db
      .insert(appSettings)
      .values({
        key: "results_public",
        value: serialized,
        updatedAt: nowIso,
        updatedById: actorId,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: serialized,
          updatedAt: nowIso,
          updatedById: actorId,
        },
      });
    settingsPublicCache.set("results_public", value);
    invalidateLeaderboardCaches();
  } catch (error) {
    console.error("Failed to update results_public setting:", error);
    throw new Error("تعذّر تحديث إعدادات النتائج", { cause: error });
  }
}

export async function getTeacherEntryEnabled(): Promise<boolean> {
  const cached = settingsEntryCache.get("teacher_entry_enabled");
  if (cached !== undefined) return cached;

  return dataSf.run("settings:teacher_entry_enabled", async () => {
    await ensureInitialDataSeeded();
    try {
      const db = getDb();
      const rows = await db
        .select({ value: appSettings.value })
        .from(appSettings)
        .where(eq(appSettings.key, "teacher_entry_enabled"))
        .limit(1);
      const val = rows[0]?.value !== "false";
      settingsEntryCache.set("teacher_entry_enabled", val);
      return val;
    } catch (error) {
      console.error("Failed to read teacher_entry_enabled setting:", error);
      throw new Error("تعذّر قراءة إعدادات إدخال المعلمين", { cause: error });
    }
  });
}

export async function setTeacherEntryEnabled(value: boolean, actorId: string): Promise<void> {
  await ensureInitialDataSeeded();
  try {
    const db = getDb();
    const nowIso = new Date().toISOString();
    const serialized = value ? "true" : "false";
    await db
      .insert(appSettings)
      .values({
        key: "teacher_entry_enabled",
        value: serialized,
        updatedAt: nowIso,
        updatedById: actorId,
      })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: serialized,
          updatedAt: nowIso,
          updatedById: actorId,
        },
      });
    settingsEntryCache.set("teacher_entry_enabled", value);
  } catch (error) {
    console.error("Failed to update teacher_entry_enabled setting:", error);
    throw new Error("تعذّر تحديث إعدادات إدخال المعلمين", { cause: error });
  }
}

export async function getPublicLeaderboard(): Promise<{ open: boolean; rows: { full_name: string; days: number }[] }> {
  const cached = leaderboardCache.get("public");
  if (cached) return cached;

  return dataSf.run("leaderboard:public", async () => {
    const open = await getResultsPublic();
    if (!open) {
      const closed = { open: false, rows: [] };
      leaderboardCache.set("public", closed);
      return closed;
    }

    try {
      const db = getDb();
      const [studentRows, attendanceRows] = await Promise.all([
        db.select({ id: students.id, full_name: students.fullName }).from(students),
        db.select({ student_id: attendance.studentId }).from(attendance),
      ]);

      const payload = {
        open: true,
        rows: computePublicLeaderboard(studentRows, attendanceRows),
      };
      leaderboardCache.set("public", payload);
      return payload;
    } catch (error) {
      console.error("Failed to compute public leaderboard:", error);
      throw new Error("تعذّر تحميل لوحة النتائج", { cause: error });
    }
  });
}

export async function getAssistantChatMessages(userId: string): Promise<unknown[]> {
  const { getAssistantConversationMessages } = await import("./assistant-db.server");
  const res = await getAssistantConversationMessages(userId);
  return res.messages;
}

export async function upsertAssistantChatMessages(
  userId: string,
  messages: unknown[],
  conversationId?: string | null,
): Promise<void> {
  const { saveAssistantConversationMessages } = await import("./assistant-db.server");
  await saveAssistantConversationMessages(userId, conversationId, messages as never);
}

export async function clearAssistantChatMessages(userId: string): Promise<void> {
  const { clearAllAssistantConversations } = await import("./assistant-db.server");
  await clearAllAssistantConversations(userId);
}
