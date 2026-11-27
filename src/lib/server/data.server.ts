import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import {
  computePublicLeaderboard,
  normalizePastAttendanceDates,
  STAFF_LIMITS,
  validateStudentDisplayName,
} from "@/lib/firebase/domain";
import type { AttendanceRow, StaffRecordingItem, StaffSessionUser, Student } from "@/lib/types";
import { appSettings, assistantChats, attendance, students } from "../../db/schema.ts";
import { ensureInitialDataSeeded, getDb } from "./db.server";

export type DayRow = {
  id: string;
  student_id: string;
  full_name: string;
  created_at: string;
};

export async function listStudents(): Promise<Student[]> {
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

    return { status: "created", student: { id, full_name, created_at: nowIso } };
  } catch (error) {
    console.error("Failed to add student:", error);
    throw new Error("تعذّر إضافة الطالب", { cause: error });
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
    return deleted.length > 0;
  } catch (error) {
    console.error("Failed to delete student:", error);
    throw new Error("تعذّر حذف الطالب", { cause: error });
  }
}

export async function listDayAttendance(date: string): Promise<DayRow[]> {
  if (!STAFF_LIMITS.DATE_PATTERN.test(date)) return [];
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
    const studentRows = await db
      .select({ id: students.id, fullName: students.fullName })
      .from(students)
      .where(eq(students.id, studentId))
      .limit(1);

    const student = studentRows[0];
    if (!student) return { status: "not_found" };

    const attId = `${attendedOn}_${student.id}`;
    const nowIso = new Date().toISOString();
    const inserted = await db
      .insert(attendance)
      .values({
        id: attId,
        studentId: student.id,
        studentName: student.fullName,
        attendedOn,
        recordedById: actor.id,
        recordedByName: actor.name,
        recordedByUsername: actor.username,
        createdAt: nowIso,
      })
      .onConflictDoNothing()
      .returning({ id: attendance.id });

    return { status: inserted.length > 0 ? "recorded" : "duplicate" };
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
    return deleted.length > 0;
  } catch (error) {
    console.error("Failed to delete attendance:", error);
    throw new Error("تعذّر إلغاء سجل الحضور", { cause: error });
  }
}

export async function getResultsPublic(): Promise<boolean> {
  await ensureInitialDataSeeded();
  try {
    const db = getDb();
    const rows = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "results_public"))
      .limit(1);
    return rows[0]?.value === "true";
  } catch (error) {
    console.error("Failed to read results_public setting:", error);
    throw new Error("تعذّر قراءة إعدادات النتائج", { cause: error });
  }
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
  } catch (error) {
    console.error("Failed to update results_public setting:", error);
    throw new Error("تعذّر تحديث إعدادات النتائج", { cause: error });
  }
}

export async function getPublicLeaderboard(): Promise<{ open: boolean; rows: { full_name: string; days: number }[] }> {
  const open = await getResultsPublic();
  if (!open) return { open: false, rows: [] };

  try {
    const db = getDb();
    const [studentRows, attendanceRows] = await Promise.all([
      db.select({ id: students.id, full_name: students.fullName }).from(students),
      db.select({ student_id: attendance.studentId }).from(attendance),
    ]);

    return {
      open: true,
      rows: computePublicLeaderboard(studentRows, attendanceRows),
    };
  } catch (error) {
    console.error("Failed to compute public leaderboard:", error);
    throw new Error("تعذّر تحميل لوحة النتائج", { cause: error });
  }
}

export async function getAssistantChatMessages(userId: string): Promise<unknown[]> {
  try {
    const db = getDb();
    const rows = await db
      .select({ messages: assistantChats.messages })
      .from(assistantChats)
      .where(eq(assistantChats.userId, userId))
      .limit(1);

    const raw = rows[0]?.messages;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  } catch (error) {
    console.error("Failed to fetch assistant chat messages:", error);
    throw new Error("تعذّر تحميل سجل المساعد", { cause: error });
  }
}

export async function upsertAssistantChatMessages(userId: string, messages: unknown[]): Promise<void> {
  try {
    const db = getDb();
    const nowIso = new Date().toISOString();
    const serialized = JSON.stringify(messages);
    await db
      .insert(assistantChats)
      .values({
        userId,
        messages: serialized,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: assistantChats.userId,
        set: {
          messages: serialized,
          updatedAt: nowIso,
        },
      });
  } catch (error) {
    console.error("Failed to save assistant chat messages:", error);
    throw new Error("تعذّر حفظ محادثة المساعد", { cause: error });
  }
}

export async function clearAssistantChatMessages(userId: string): Promise<void> {
  try {
    const db = getDb();
    await db.delete(assistantChats).where(eq(assistantChats.userId, userId));
  } catch (error) {
    console.error("Failed to clear assistant chat messages:", error);
    throw new Error("تعذّر مسح محادثة المساعد", { cause: error });
  }
}
