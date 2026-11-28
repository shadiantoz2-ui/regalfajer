import { cleanDisplayName, normalizeName } from "@/lib/arabic";
import { emailToLogin, loginToEmail } from "@/lib/login";
import type { AttendanceRow, Student } from "@/lib/types";

// Synchronized with firebase-blueprint.json and firestore.rules
export const STAFF_LIMITS = {
  NAME_MIN: 2,
  NAME_MAX: 80,
  USERNAME_MIN: 2,
  USERNAME_MAX: 48,
  USERNAME_PATTERN: /^[a-z0-9][a-z0-9._-]{1,47}$/,
  PASSWORD_MIN: 6,
  PASSWORD_MAX: 72,
  EMAIL_MIN: 3,
  EMAIL_MAX: 150,
  EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  STUDENT_NAME_MIN: 2,
  STUDENT_NAME_MAX: 120,
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  DATE_PATTERN: /^\d{4}-\d{2}-\d{2}$/,
} as const;

export type StaffRole = "admin" | "teacher";

export type StaffAccount = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  uid: string;
  status: "pending" | "active";
  createdAt: string;
  updatedAt: string;
  createdByUid: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Deterministic Firestore doc ID matching firestore.rules `emailDocKey`. */
export function emailDocKey(email: string): string {
  return normalizeEmail(email).replace(/[^a-z0-9]/g, "_");
}

/** Deterministic Firestore attendance doc ID matching firestore.rules. */
export function attendanceDocId(attendedOn: string, studentId: string): string {
  return `${attendedOn}_${studentId}`;
}

export function isValidStaffEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  return (
    normalized.length >= STAFF_LIMITS.EMAIL_MIN &&
    normalized.length <= STAFF_LIMITS.EMAIL_MAX &&
    STAFF_LIMITS.EMAIL_PATTERN.test(normalized)
  );
}

export function isValidStaffUsernameOrEmail(rawLogin: string): boolean {
  const cleaned = normalizeEmail(rawLogin);
  if (!cleaned) return false;
  if (cleaned.includes("@")) {
    return isValidStaffEmail(cleaned);
  }
  return (
    cleaned.length >= STAFF_LIMITS.USERNAME_MIN &&
    cleaned.length <= STAFF_LIMITS.USERNAME_MAX &&
    STAFF_LIMITS.USERNAME_PATTERN.test(cleaned) &&
    isValidStaffEmail(loginToEmail(cleaned))
  );
}

export function validateStaffAccountInput(input: {
  name: string;
  username: string;
  password?: string;
  role: StaffRole;
  requirePassword?: boolean;
}):
  | { ok: true; name: string; email: string; username: string; role: StaffRole }
  | { ok: false; error: string } {
  const name = cleanDisplayName(input.name);
  const rawLogin = normalizeEmail(input.username);
  if (name.length < STAFF_LIMITS.NAME_MIN || name.length > STAFF_LIMITS.NAME_MAX) {
    return { ok: false, error: "اكتب الاسم بين حرفين و80 حرفاً" };
  }
  if (!isValidStaffUsernameOrEmail(rawLogin)) {
    return {
      ok: false,
      error: "اسم المستخدم يجب أن يكون بالإنجليزية (حروف وأرقام أو . _ - فقط، وبحرفين على الأقل)",
    };
  }
  if (input.requirePassword !== false) {
    const pwd = input.password ?? "";
    if (pwd.length < STAFF_LIMITS.PASSWORD_MIN || pwd.length > STAFF_LIMITS.PASSWORD_MAX) {
      return { ok: false, error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" };
    }
  }
  if (input.role !== "admin" && input.role !== "teacher") {
    return { ok: false, error: "الدور غير صالح" };
  }
  const email = loginToEmail(rawLogin);
  return {
    ok: true,
    name,
    email,
    username: emailToLogin(email),
    role: input.role,
  };
}

export function validateStudentDisplayName(rawName: string): {
  valid: boolean;
  full_name: string;
  normalized_name: string;
} {
  const full_name = cleanDisplayName(rawName).slice(0, STAFF_LIMITS.STUDENT_NAME_MAX);
  const normalized_name = normalizeName(full_name).slice(0, STAFF_LIMITS.STUDENT_NAME_MAX);
  const valid =
    full_name.length >= STAFF_LIMITS.STUDENT_NAME_MIN &&
    normalized_name.length >= STAFF_LIMITS.STUDENT_NAME_MIN;
  return { valid, full_name, normalized_name };
}

export function resolveRoleForAccount(
  uid: string | null | undefined,
  email: string | null | undefined,
  profileDoc: { uid?: unknown; role?: unknown; email?: unknown } | null,
): StaffRole | null {
  if (!uid || !email || !profileDoc) return null;
  const normalized = normalizeEmail(email);
  if (typeof profileDoc.uid === "string" && profileDoc.uid !== uid) {
    return null;
  }
  if (typeof profileDoc.email === "string" && normalizeEmail(profileDoc.email) !== normalized) {
    return null;
  }
  if (profileDoc.role === "admin" || profileDoc.role === "teacher") {
    return profileDoc.role;
  }
  return null;
}

export function computePublicLeaderboard(
  students: Pick<Student, "id" | "full_name">[],
  attendance: Pick<AttendanceRow, "student_id">[],
): { full_name: string; days: number }[] {
  const counts = new Map<string, number>();
  for (const row of attendance) {
    counts.set(row.student_id, (counts.get(row.student_id) ?? 0) + 1);
  }
  return students
    .map((s) => ({
      full_name: s.full_name,
      days: counts.get(s.id) ?? 0,
    }))
    .sort((a, b) => b.days - a.days || a.full_name.localeCompare(b.full_name, "ar"))
    .slice(0, 1000);
}

export function normalizePastAttendanceDates(
  rawDates: readonly string[],
  maxDate: string,
  existingDates: ReadonlySet<string> = new Set(),
): { validDates: string[]; skippedCount: number } {
  const uniqueValid = new Set<string>();
  let skippedCount = 0;

  for (const raw of rawDates) {
    const clean = raw.trim();
    if (!STAFF_LIMITS.DATE_PATTERN.test(clean)) continue;
    if (maxDate && STAFF_LIMITS.DATE_PATTERN.test(maxDate) && clean > maxDate) continue;
    if (existingDates.has(clean)) {
      if (!uniqueValid.has(clean)) skippedCount += 1;
      continue;
    }
    uniqueValid.add(clean);
  }

  return {
    validDates: Array.from(uniqueValid).sort((a, b) => a.localeCompare(b)),
    skippedCount,
  };
}

export const TEACHER_ENTRY_BLOCKED_MESSAGE = "تم إيقاف إدخال البيانات للمعلمين مؤقتاً من قِبل الإدارة";

export function canRoleEnterData(role: StaffRole, teacherEntryEnabled: boolean): boolean {
  return role === "admin" || teacherEntryEnabled;
}
