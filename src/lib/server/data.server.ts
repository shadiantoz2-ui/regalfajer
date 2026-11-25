import { randomUUID } from "node:crypto";
import { cleanDisplayName, normalizeName } from "@/lib/arabic";
import {
  computePublicLeaderboard,
  normalizePastAttendanceDates,
  STAFF_LIMITS,
  validateStudentDisplayName,
} from "@/lib/firebase/domain";
import { HISTORICAL_NOV2026_SEED } from "@/lib/seed-nov2026";
import type { AttendanceRow, StaffRecordingItem, StaffSessionUser, Student } from "@/lib/types";
import { getDb } from "./db.server";

export type DayRow = {
  id: string;
  student_id: string;
  full_name: string;
  created_at: string;
};

export function listStudents(): Student[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT id, full_name, created_at FROM students`)
    .all() as Array<{ id: string; full_name: string; created_at: string }>;
  return rows.sort((a, b) => a.full_name.localeCompare(b.full_name, "ar"));
}

export function addStudent(
  rawName: string,
  actorId: string,
):
  | { status: "created"; student: Student }
  | { status: "duplicate"; existing: string; student: Student }
  | { status: "invalid" } {
  const { valid, full_name, normalized_name } = validateStudentDisplayName(rawName);
  if (!valid) return { status: "invalid" };

  const db = getDb();
  const existing = db
    .prepare(`SELECT id, full_name, created_at FROM students WHERE normalized_name = ?`)
    .get(normalized_name) as Student | undefined;
  if (existing) {
    return { status: "duplicate", existing: existing.full_name, student: existing };
  }

  const id = randomUUID();
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO students (id, full_name, normalized_name, created_by_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, full_name, normalized_name, actorId, nowIso, nowIso);

  return { status: "created", student: { id, full_name, created_at: nowIso } };
}

export function renameStudent(
  id: string,
  rawName: string,
): { status: "renamed" } | { status: "duplicate"; existing: string } | { status: "invalid" } {
  const { valid, full_name, normalized_name } = validateStudentDisplayName(rawName);
  if (!valid || !id) return { status: "invalid" };

  const db = getDb();
  const existing = db
    .prepare(`SELECT id, full_name FROM students WHERE normalized_name = ?`)
    .get(normalized_name) as { id: string; full_name: string } | undefined;
  if (existing && existing.id !== id) {
    return { status: "duplicate", existing: existing.full_name };
  }

  const target = db.prepare(`SELECT id FROM students WHERE id = ?`).get(id) as { id: string } | undefined;
  if (!target) return { status: "invalid" };

  const nowIso = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`UPDATE students SET full_name = ?, normalized_name = ?, updated_at = ? WHERE id = ?`).run(
      full_name,
      normalized_name,
      nowIso,
      id,
    );
    db.prepare(`UPDATE attendance SET student_name = ? WHERE student_id = ?`).run(full_name, id);
    db.exec("COMMIT");
    return { status: "renamed" };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function deleteStudent(id: string): boolean {
  const db = getDb();
  const res = db.prepare(`DELETE FROM students WHERE id = ?`).run(id);
  return Number(res.changes) > 0;
}

export function importHistoricalAttendanceSeed(): { studentsCreated: number; attendanceCreated: number } {
  const db = getDb();
  let studentsCreated = 0;
  let attendanceCreated = 0;

  db.exec("BEGIN IMMEDIATE");
  try {
    const findStudent = db.prepare(`SELECT id, full_name FROM students WHERE normalized_name = ?`);
    const insertStudent = db.prepare(
      `INSERT INTO students (id, full_name, normalized_name, created_by_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertAttendance = db.prepare(
      `INSERT OR IGNORE INTO attendance (
        id, student_id, student_name, attended_on, recorded_by_id, recorded_by_name, recorded_by_username, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const nowIso = new Date().toISOString();
    for (const item of HISTORICAL_NOV2026_SEED) {
      const fullName = cleanDisplayName(item.fullName);
      const normalized = normalizeName(fullName);
      if (!fullName || !normalized) continue;

      let studentRow = findStudent.get(normalized) as { id: string; full_name: string } | undefined;
      if (!studentRow) {
        const id = randomUUID();
        insertStudent.run(id, fullName, normalized, "system_seed", nowIso, nowIso);
        studentRow = { id, full_name: fullName };
        studentsCreated += 1;
      }

      for (const attendedOn of item.dates) {
        const attId = `${attendedOn}_${studentRow.id}`;
        const changes = insertAttendance.run(
          attId,
          studentRow.id,
          studentRow.full_name,
          attendedOn,
          "system_seed",
          "سجل الإدارة",
          "system",
          `${attendedOn}T04:30:00.000Z`,
        ).changes;
        if (Number(changes) > 0) attendanceCreated += 1;
      }
    }

    db.prepare(`INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)`).run("nov2026_seeded", "1");
    db.exec("COMMIT");
    return { studentsCreated, attendanceCreated };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function listDayAttendance(date: string): DayRow[] {
  if (!STAFF_LIMITS.DATE_PATTERN.test(date)) return [];
  const db = getDb();
  return db
    .prepare(
      `SELECT id, student_id, student_name AS full_name, created_at
       FROM attendance
       WHERE attended_on = ?
       ORDER BY created_at DESC`,
    )
    .all(date) as DayRow[];
}

export function listStudentAttendance(studentId: string): AttendanceRow[] {
  if (!studentId) return [];
  const db = getDb();
  return db
    .prepare(
      `SELECT id, student_id, attended_on, created_at
       FROM attendance
       WHERE student_id = ?
       ORDER BY attended_on DESC`,
    )
    .all(studentId) as AttendanceRow[];
}

export function listAllAttendance(from?: string, to?: string): AttendanceRow[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: string[] = [];

  if (from && STAFF_LIMITS.DATE_PATTERN.test(from)) {
    clauses.push("attended_on >= ?");
    params.push(from);
  }
  if (to && STAFF_LIMITS.DATE_PATTERN.test(to)) {
    clauses.push("attended_on <= ?");
    params.push(to);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(
      `SELECT id, student_id, attended_on, created_at
       FROM attendance
       ${whereSql}
       ORDER BY attended_on ASC, created_at ASC`,
    )
    .all(...params) as AttendanceRow[];
}

export function listStaffDayRecordings(staffId: string, date: string): StaffRecordingItem[] {
  if (!staffId || !STAFF_LIMITS.DATE_PATTERN.test(date)) return [];
  const db = getDb();
  return db
    .prepare(
      `SELECT
         id,
         recorded_by_id AS teacherId,
         recorded_by_username AS teacherUsername,
         recorded_by_name AS teacherName,
         student_id AS studentId,
         student_name AS studentName,
         attended_on AS attendedOn,
         created_at AS recordedAt
       FROM attendance
       WHERE recorded_by_id = ? AND attended_on = ?
       ORDER BY created_at DESC`,
    )
    .all(staffId, date) as StaffRecordingItem[];
}

export function recordAttendance(
  studentId: string,
  attendedOn: string,
  actor: StaffSessionUser,
): { status: "recorded" | "duplicate" | "not_found" } {
  if (!STAFF_LIMITS.DATE_PATTERN.test(attendedOn)) {
    throw new Error("تاريخ غير صالح");
  }
  const db = getDb();
  const student = db
    .prepare(`SELECT id, full_name FROM students WHERE id = ?`)
    .get(studentId) as { id: string; full_name: string } | undefined;
  if (!student) return { status: "not_found" };

  const attId = `${attendedOn}_${student.id}`;
  const nowIso = new Date().toISOString();
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO attendance (
        id, student_id, student_name, attended_on, recorded_by_id, recorded_by_name, recorded_by_username, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(attId, student.id, student.full_name, attendedOn, actor.id, actor.name, actor.username, nowIso);

  return { status: Number(res.changes) > 0 ? "recorded" : "duplicate" };
}

export function recordAttendanceBulk(
  studentIds: readonly string[],
  attendedOn: string,
  actor: StaffSessionUser,
): { recorded: number; skipped: number } {
  if (!STAFF_LIMITS.DATE_PATTERN.test(attendedOn)) {
    throw new Error("تاريخ غير صالح");
  }
  const uniqueIds = Array.from(new Set(studentIds.filter(Boolean)));
  if (!uniqueIds.length) return { recorded: 0, skipped: 0 };

  const db = getDb();
  let recorded = 0;
  let skipped = 0;
  const nowIso = new Date().toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    const findStudent = db.prepare(`SELECT id, full_name FROM students WHERE id = ?`);
    const insertAttendance = db.prepare(
      `INSERT OR IGNORE INTO attendance (
        id, student_id, student_name, attended_on, recorded_by_id, recorded_by_name, recorded_by_username, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const studentId of uniqueIds) {
      const student = findStudent.get(studentId) as { id: string; full_name: string } | undefined;
      if (!student) {
        skipped += 1;
        continue;
      }
      const changes = insertAttendance.run(
        `${attendedOn}_${student.id}`,
        student.id,
        student.full_name,
        attendedOn,
        actor.id,
        actor.name,
        actor.username,
        nowIso,
      ).changes;
      if (Number(changes) > 0) recorded += 1;
      else skipped += 1;
    }

    db.exec("COMMIT");
    return { recorded, skipped };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function recordStudentPastDates(
  studentId: string,
  dates: readonly string[],
  maxDate: string,
  actor: StaffSessionUser,
): { recorded: number; skipped: number } {
  const db = getDb();
  const student = db
    .prepare(`SELECT id, full_name FROM students WHERE id = ?`)
    .get(studentId) as { id: string; full_name: string } | undefined;
  if (!student) {
    throw new Error("الطالب غير موجود");
  }

  const existing = db
    .prepare(`SELECT attended_on FROM attendance WHERE student_id = ?`)
    .all(student.id) as Array<{ attended_on: string }>;
  const existingSet = new Set(existing.map((r) => r.attended_on));

  const { validDates, skippedCount } = normalizePastAttendanceDates(dates, maxDate, existingSet);
  if (!validDates.length) return { recorded: 0, skipped: skippedCount };

  const nowIso = new Date().toISOString();
  let recorded = 0;

  db.exec("BEGIN IMMEDIATE");
  try {
    const insertAttendance = db.prepare(
      `INSERT OR IGNORE INTO attendance (
        id, student_id, student_name, attended_on, recorded_by_id, recorded_by_name, recorded_by_username, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const attendedOn of validDates) {
      const changes = insertAttendance.run(
        `${attendedOn}_${student.id}`,
        student.id,
        student.full_name,
        attendedOn,
        actor.id,
        actor.name,
        actor.username,
        nowIso,
      ).changes;
      if (Number(changes) > 0) recorded += 1;
    }
    db.exec("COMMIT");
    return { recorded, skipped: skippedCount };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function deleteAttendance(id: string): boolean {
  const db = getDb();
  const res = db.prepare(`DELETE FROM attendance WHERE id = ?`).run(id);
  return Number(res.changes) > 0;
}

export function getResultsPublic(): boolean {
  const db = getDb();
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get("results_public") as { value?: string } | undefined;
  return row?.value === "true";
}

export function setResultsPublic(value: boolean, actorId: string): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO app_settings (key, value, updated_at, updated_by_id) VALUES (?, ?, ?, ?)`,
  ).run("results_public", value ? "true" : "false", new Date().toISOString(), actorId);
}

export function getPublicLeaderboard(): { open: boolean; rows: { full_name: string; days: number }[] } {
  const open = getResultsPublic();
  if (!open) return { open: false, rows: [] };

  const db = getDb();
  const students = db
    .prepare(`SELECT id, full_name FROM students`)
    .all() as Array<{ id: string; full_name: string }>;
  const attendance = db
    .prepare(`SELECT student_id FROM attendance`)
    .all() as Array<{ student_id: string }>;

  return {
    open: true,
    rows: computePublicLeaderboard(students, attendance),
  };
}

export function getAssistantChatMessages(userId: string): unknown[] {
  const db = getDb();
  const row = db
    .prepare(`SELECT messages FROM assistant_chats WHERE user_id = ?`)
    .get(userId) as { messages?: string } | undefined;
  if (!row?.messages) return [];
  try {
    const parsed = JSON.parse(row.messages) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function upsertAssistantChatMessages(userId: string, messages: unknown[]): void {
  const db = getDb();
  const trimmed = messages.slice(-100);
  db.prepare(
    `INSERT OR REPLACE INTO assistant_chats (user_id, messages, updated_at) VALUES (?, ?, ?)`,
  ).run(userId, JSON.stringify(trimmed), new Date().toISOString());
}

export function clearAssistantChatMessages(userId: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM assistant_chats WHERE user_id = ?`).run(userId);
}
