import type { QueryClient } from "@tanstack/react-query";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import firebaseConfig from "../../../firebase-applet-config.json";
import { auth, db, handleFirestoreError, OperationType } from "./client";
import { createManagedStaffAuthUser, fetchBootstrapAdminUid } from "./auth";
import {
  attendanceDocId,
  computePublicLeaderboard,
  emailDocKey,
  normalizeEmail,
  normalizePastAttendanceDates,
  STAFF_LIMITS,
  validateStaffAccountInput,
  validateStudentDisplayName,
  type StaffAccount,
  type StaffRole,
} from "./domain";
import { emailToLogin } from "@/lib/login";
import { HISTORICAL_NOV2026_SEED, type HistoricalStudentSeed } from "@/lib/seed-nov2026";
import type { AttendanceRow, Student } from "@/lib/types";

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === "string" && val) return val;
  return new Date().toISOString();
}

function getCurrentStaffMeta() {
  const user = auth.currentUser;
  if (!user) throw new Error("انتهت الجلسة، سجّل الدخول أولاً");
  const email = normalizeEmail(user.email ?? "");
  const name = (user.displayName?.trim() || emailToLogin(email) || "موظف").slice(0, STAFF_LIMITS.NAME_MAX);
  return { uid: user.uid, email, name };
}

async function runInParallelChunks<T>(
  items: readonly T[],
  chunkSize: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    await Promise.all(items.slice(i, i + chunkSize).map((item) => worker(item)));
  }
}

async function resolveCallerDisplayInfo(): Promise<{ uid: string; email: string; name: string; role: StaffRole }> {
  const meta = getCurrentStaffMeta();
  try {
    const snap = await getDoc(doc(db, "staff_profiles", meta.uid));
    if (snap.exists()) {
      const d = snap.data();
      const rawEmail = typeof d["email"] === "string" ? normalizeEmail(d["email"]) : "";
      const rawName = typeof d["name"] === "string" ? d["name"].trim() : "";
      const role: StaffRole = d["role"] === "admin" ? "admin" : "teacher";
      return {
        uid: meta.uid,
        email: (rawEmail || meta.email).slice(0, STAFF_LIMITS.EMAIL_MAX),
        name: (rawName || meta.name).slice(0, STAFF_LIMITS.NAME_MAX),
        role,
      };
    }
  } catch {
    /* fallback to auth metadata */
  }
  return {
    uid: meta.uid,
    email: meta.email.slice(0, STAFF_LIMITS.EMAIL_MAX),
    name: meta.name.slice(0, STAFF_LIMITS.NAME_MAX),
    role: "teacher",
  };
}

// --- Staff Accounts (Teachers & Admins) ---

export async function listStaffAccounts(): Promise<StaffAccount[]> {
  const path = "staff_accounts";
  try {
    const snap = await getDocs(query(collection(db, "staff_accounts"), orderBy("name")));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: String(data["name"] ?? ""),
        email: String(data["email"] ?? ""),
        role: data["role"] === "admin" ? "admin" : "teacher",
        uid: String(data["uid"] ?? ""),
        status: data["status"] === "active" ? "active" : "pending",
        createdAt: toIsoString(data["createdAt"]),
        updatedAt: toIsoString(data["updatedAt"]),
        createdByUid: String(data["createdByUid"] ?? ""),
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function createStaffAccount(input: {
  name: string;
  username: string;
  password: string;
  role: StaffRole;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const validated = validateStaffAccountInput({
    name: input.name,
    username: input.username,
    password: input.password,
    role: input.role,
    requirePassword: true,
  });
  if (!validated.ok) return validated;

  const meta = getCurrentStaffMeta();
  const key = emailDocKey(validated.email);
  const path = `staff_accounts/${key}`;

  try {
    const existing = await getDoc(doc(db, "staff_accounts", key));
    if (existing.exists()) {
      return { ok: false, error: "اسم المستخدم هذا مسجّل مسبقاً" };
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }

  let createdUid: string;
  try {
    createdUid = await createManagedStaffAuthUser({
      email: validated.email,
      password: input.password,
      name: validated.name,
    });
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? String(err.code) : "";
    if (code === "auth/email-already-in-use") {
      return { ok: false, error: "اسم المستخدم هذا مستخدم مسبقاً في نظام الدخول، اختر اسماً آخر" };
    }
    if (code === "auth/operation-not-allowed") {
      return {
        ok: false,
        error: "يجب تفعيل تسجيل الدخول بالبريد وكلمة المرور (Email/Password) من لوحة Firebase أولاً",
      };
    }
    if (code === "auth/weak-password") {
      return { ok: false, error: "كلمة المرور ضعيفة، استخدم 6 أحرف على الأقل" };
    }
    return { ok: false, error: "تعذّر إنشاء بيانات الدخول لهذا الحساب" };
  }

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "staff_accounts", key), {
      name: validated.name,
      email: validated.email,
      role: validated.role,
      uid: createdUid,
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: meta.uid,
    });
    batch.set(doc(db, "staff_profiles", createdUid), {
      uid: createdUid,
      email: validated.email,
      name: validated.name,
      role: validated.role,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return { ok: true };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateStaffAccount(
  account: StaffAccount,
  patch: { name: string; role: StaffRole },
): Promise<void> {
  const validated = validateStaffAccountInput({
    name: patch.name,
    username: account.email,
    role: patch.role,
    requirePassword: false,
  });
  if (!validated.ok) throw new Error(validated.error);

  const meta = getCurrentStaffMeta();
  const bootstrapAdminUid = await fetchBootstrapAdminUid();
  if (account.uid && bootstrapAdminUid && account.uid === bootstrapAdminUid && validated.role !== "admin") {
    throw new Error("لا يمكن تغيير دور المدير الأساسي");
  }
  if (account.uid && account.uid === meta.uid && validated.role !== "admin") {
    throw new Error("لا يمكنك إلغاء صلاحية الإدارة عن حسابك الحالي");
  }

  const key = emailDocKey(account.email);
  const path = `staff_accounts/${key}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "staff_accounts", key), {
      name: validated.name,
      role: validated.role,
      updatedAt: serverTimestamp(),
    });
    if (account.uid) {
      const profileRef = doc(db, "staff_profiles", account.uid);
      const profileSnap = await getDoc(profileRef);
      if (profileSnap.exists()) {
        batch.update(profileRef, {
          name: validated.name,
          role: validated.role,
          updatedAt: serverTimestamp(),
        });
      }
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteStaffAccount(account: StaffAccount): Promise<void> {
  const meta = getCurrentStaffMeta();
  const bootstrapAdminUid = await fetchBootstrapAdminUid();
  if (account.uid && account.uid === meta.uid) {
    throw new Error("لا يمكنك حذف حسابك الحالي");
  }
  if (account.uid && bootstrapAdminUid && account.uid === bootstrapAdminUid) {
    throw new Error("لا يمكن حذف حساب المدير الأساسي");
  }
  const key = emailDocKey(account.email);
  const path = `staff_accounts/${key}`;
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, "staff_accounts", key));
    if (account.uid) {
      const profileRef = doc(db, "staff_profiles", account.uid);
      const profileSnap = await getDoc(profileRef);
      if (profileSnap.exists()) {
        batch.delete(profileRef);
      }
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// --- Students ---

export async function fetchStudentsFirestore(): Promise<Student[]> {
  const path = "students";
  try {
    const snap = await getDocs(query(collection(db, "students"), orderBy("full_name")));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        full_name: String(data["full_name"] ?? ""),
        created_at: toIsoString(data["createdAt"]),
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function addStudentFirestore(rawName: string): Promise<
  | { status: "invalid" }
  | { status: "duplicate"; student: Student | null }
  | { status: "created"; student: Student }
> {
  const { valid, full_name, normalized_name } = validateStudentDisplayName(rawName);
  if (!valid) return { status: "invalid" };

  const meta = getCurrentStaffMeta();
  const path = "students";
  try {
    const dupSnap = await getDocs(
      query(collection(db, "students"), where("normalized_name", "==", normalized_name)),
    );
    if (!dupSnap.empty) {
      const first = dupSnap.docs[0]!;
      const d = first.data();
      return {
        status: "duplicate",
        student: {
          id: first.id,
          full_name: String(d["full_name"] ?? full_name),
          created_at: toIsoString(d["createdAt"]),
        },
      };
    }

    const newRef = doc(collection(db, "students"));
    await setDoc(newRef, {
      full_name,
      normalized_name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: meta.uid,
    });
    const student: Student = {
      id: newRef.id,
      full_name,
      created_at: new Date().toISOString(),
    };
    await syncPublicResultsBestEffort();
    return { status: "created", student };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function renameStudentFirestore(
  id: string,
  rawName: string,
): Promise<{ status: "renamed" | "invalid" } | { status: "duplicate"; existing: string }> {
  const { valid, full_name, normalized_name } = validateStudentDisplayName(rawName);
  if (!valid || full_name.split(" ").length < 2) return { status: "invalid" };

  const path = `students/${id}`;
  try {
    const dupSnap = await getDocs(
      query(collection(db, "students"), where("normalized_name", "==", normalized_name)),
    );
    const conflict = dupSnap.docs.find((d) => d.id !== id);
    if (conflict) {
      return { status: "duplicate", existing: String(conflict.data()["full_name"] ?? full_name) };
    }

    await updateDoc(doc(db, "students", id), {
      full_name,
      normalized_name,
      updatedAt: serverTimestamp(),
    });
    await syncPublicResultsBestEffort();
    return { status: "renamed" };
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteStudentFirestore(id: string): Promise<void> {
  const path = `students/${id}`;
  try {
    const attSnap = await getDocs(query(collection(db, "attendance"), where("student_id", "==", id)));
    const DELETE_BATCH_LIMIT = 5;
    for (let i = 0; i < attSnap.docs.length; i += DELETE_BATCH_LIMIT) {
      const batch = writeBatch(db);
      for (const attDoc of attSnap.docs.slice(i, i + DELETE_BATCH_LIMIT)) {
        batch.delete(attDoc.ref);
      }
      await batch.commit();
    }
    await deleteDoc(doc(db, "students", id));
    await syncPublicResultsBestEffort();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// --- Attendance ---

export type DayRow = AttendanceRow & { full_name: string };

export async function fetchDayFirestore(date: string): Promise<DayRow[]> {
  const path = "attendance";
  try {
    const snap = await getDocs(query(collection(db, "attendance"), where("attended_on", "==", date)));
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          student_id: String(data["student_id"] ?? ""),
          attended_on: String(data["attended_on"] ?? date),
          created_at: toIsoString(data["createdAt"]),
          full_name: String(data["student_name"] ?? ""),
        };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function fetchStudentAttendanceFirestore(studentId: string): Promise<AttendanceRow[]> {
  const path = "attendance";
  try {
    const snap = await getDocs(query(collection(db, "attendance"), where("student_id", "==", studentId)));
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          student_id: String(data["student_id"] ?? studentId),
          attended_on: String(data["attended_on"] ?? ""),
          created_at: toIsoString(data["createdAt"]),
        };
      })
      .sort((a, b) => b.attended_on.localeCompare(a.attended_on));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function fetchAllAttendanceFirestore(from?: string, to?: string): Promise<AttendanceRow[]> {
  const path = "attendance";
  try {
    const snap = await getDocs(query(collection(db, "attendance"), orderBy("attended_on")));
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          student_id: String(data["student_id"] ?? ""),
          attended_on: String(data["attended_on"] ?? ""),
          created_at: toIsoString(data["createdAt"]),
        };
      })
      .filter((r) => (!from || r.attended_on >= from) && (!to || r.attended_on <= to));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function recordAttendanceFirestore(
  qc: QueryClient,
  student: Student,
  date: string,
): Promise<"recorded" | "duplicate"> {
  const caller = await resolveCallerDisplayInfo();
  const docId = attendanceDocId(date, student.id);
  const path = `attendance/${docId}`;

  try {
    const ref = doc(db, "attendance", docId);
    const existing = await getDoc(ref);
    if (existing.exists()) {
      return "duplicate";
    }

    await setDoc(ref, {
      student_id: student.id,
      student_name: student.full_name.slice(0, STAFF_LIMITS.STUDENT_NAME_MAX),
      attended_on: date,
      recorded_by_uid: caller.uid,
      recorded_by_name: caller.name,
      recorded_by_email: caller.email,
      createdAt: serverTimestamp(),
    });

    const createdRow: DayRow = {
      id: docId,
      student_id: student.id,
      attended_on: date,
      created_at: new Date().toISOString(),
      full_name: student.full_name,
    };

    qc.setQueryData<DayRow[]>(["attendance", date], (old) =>
      old && !old.some((r) => r.id === docId) ? [createdRow, ...old] : old,
    );
    await syncPublicResultsBestEffort();
    return "recorded";
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function recordAttendanceBulkFirestore(
  qc: QueryClient,
  students: Student[],
  date: string,
): Promise<{ recorded: number; skipped: number }> {
  const caller = await resolveCallerDisplayInfo();
  const unique = Array.from(new Map(students.map((s) => [s.id, s])).values());
  if (!unique.length) return { recorded: 0, skipped: 0 };

  try {
    const pending: Array<{ ref: ReturnType<typeof doc>; student: Student }> = [];

    for (const s of unique) {
      const docId = attendanceDocId(date, s.id);
      const ref = doc(db, "attendance", docId);
      const existing = await getDoc(ref);
      if (existing.exists()) continue;
      pending.push({ ref, student: s });
    }

    if (pending.length > 0) {
      await runInParallelChunks(pending, 15, ({ ref, student }) =>
        setDoc(ref, {
          student_id: student.id,
          student_name: student.full_name.slice(0, STAFF_LIMITS.STUDENT_NAME_MAX),
          attended_on: date,
          recorded_by_uid: caller.uid,
          recorded_by_name: caller.name,
          recorded_by_email: caller.email,
          createdAt: serverTimestamp(),
        }),
      );
      await qc.invalidateQueries({ queryKey: ["attendance", date] });
      await syncPublicResultsBestEffort();
    }
    return { recorded: pending.length, skipped: unique.length - pending.length };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, "attendance");
  }
}

export async function recordStudentPastDatesFirestore(
  qc: QueryClient,
  student: Student,
  dates: readonly string[],
  maxDate: string,
): Promise<{ recorded: number; skipped: number }> {
  const caller = await resolveCallerDisplayInfo();
  if (caller.role !== "admin") {
    throw new Error("تسجيل عدة أيام سابقة متاح للمدير فقط");
  }

  try {
    const existingRows = await fetchStudentAttendanceFirestore(student.id);
    const existingDates = new Set(existingRows.map((r) => r.attended_on));
    const { validDates, skippedCount } = normalizePastAttendanceDates(dates, maxDate, existingDates);

    if (validDates.length > 0) {
      await runInParallelChunks(validDates, 15, (date) => {
        const docId = attendanceDocId(date, student.id);
        return setDoc(doc(db, "attendance", docId), {
          student_id: student.id,
          student_name: student.full_name.slice(0, STAFF_LIMITS.STUDENT_NAME_MAX),
          attended_on: date,
          recorded_by_uid: caller.uid,
          recorded_by_name: caller.name,
          recorded_by_email: caller.email,
          createdAt: serverTimestamp(),
        });
      });

      await syncPublicResultsBestEffort();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["student-attendance", student.id] }),
        qc.invalidateQueries({ queryKey: ["attendance"] }),
        qc.invalidateQueries({ queryKey: ["my-day-recordings"] }),
        qc.invalidateQueries({ queryKey: ["public-results"] }),
      ]);
    }

    return { recorded: validDates.length, skipped: skippedCount };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, "attendance");
  }
}

export async function deleteAttendanceFirestore(id: string): Promise<void> {
  const path = `attendance/${id}`;
  try {
    await deleteDoc(doc(db, "attendance", id));
    await syncPublicResultsBestEffort();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export type StaffRecordingRow = {
  id: string;
  teacherId: string;
  teacherEmail: string;
  teacherName: string;
  studentId: string;
  studentName: string;
  attendedOn: string;
  recordedAt: string;
};

export async function listMyDayRecordingsFirestore(date: string): Promise<StaffRecordingRow[]> {
  const meta = getCurrentStaffMeta();
  const path = "attendance";
  try {
    const snap = await getDocs(
      query(collection(db, "attendance"), where("recorded_by_uid", "==", meta.uid)),
    );
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          teacherId: String(data["recorded_by_uid"] ?? meta.uid),
          teacherEmail: String(data["recorded_by_email"] ?? meta.email),
          teacherName: String(data["recorded_by_name"] ?? meta.name),
          studentId: String(data["student_id"] ?? ""),
          studentName: String(data["student_name"] ?? ""),
          attendedOn: String(data["attended_on"] ?? ""),
          recordedAt: toIsoString(data["createdAt"]),
        };
      })
      .filter((r) => r.attendedOn === date)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function listTeacherDayRecordingsFirestore(
  account: Pick<StaffAccount, "uid" | "email">,
  date: string,
): Promise<StaffRecordingRow[]> {
  const path = "attendance";
  try {
    const snap = await getDocs(query(collection(db, "attendance"), where("attended_on", "==", date)));
    const targetEmail = normalizeEmail(account.email);
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          teacherId: String(data["recorded_by_uid"] ?? ""),
          teacherEmail: normalizeEmail(String(data["recorded_by_email"] ?? "")),
          teacherName: String(data["recorded_by_name"] ?? ""),
          studentId: String(data["student_id"] ?? ""),
          studentName: String(data["student_name"] ?? ""),
          attendedOn: String(data["attended_on"] ?? date),
          recordedAt: toIsoString(data["createdAt"]),
        };
      })
      .filter((r) => (account.uid && r.teacherId === account.uid) || (targetEmail && r.teacherEmail === targetEmail))
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

// --- Settings & Public Results ---

export async function fetchSettingsFirestore(): Promise<{ results_public: boolean }> {
  const path = "app_settings/global";
  try {
    const snap = await getDoc(doc(db, "app_settings", "global"));
    return { results_public: snap.exists() ? Boolean(snap.data()["results_public"]) : false };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

async function syncPublicResultsForAdmin(resultsPublic: boolean, uid: string): Promise<void> {
  const [students, attendance] = await Promise.all([
    fetchStudentsFirestore(),
    fetchAllAttendanceFirestore(),
  ]);
  const rows = computePublicLeaderboard(students, attendance);
  await setDoc(doc(db, "public_results", "latest"), {
    results_public: resultsPublic,
    rows,
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  });
}

async function syncPublicResultsBestEffort(): Promise<void> {
  try {
    const caller = await resolveCallerDisplayInfo();
    if (caller.role !== "admin") return;
    const settings = await fetchSettingsFirestore();
    await syncPublicResultsForAdmin(settings.results_public, caller.uid);
  } catch {
    /* best-effort snapshot sync */
  }
}

export async function setResultsPublicFirestore(value: boolean): Promise<void> {
  const meta = getCurrentStaffMeta();
  const path = "app_settings/global";
  try {
    await setDoc(doc(db, "app_settings", "global"), {
      results_public: value,
      updatedAt: serverTimestamp(),
      updatedByUid: meta.uid,
    });
    await syncPublicResultsForAdmin(value, meta.uid);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

async function fetchPublicDocViaRest(path: string): Promise<Record<string, unknown> | null> {
  const dbId = encodeURIComponent(firebaseConfig.firestoreDatabaseId || "(default)");
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/${dbId}/documents/${path}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Public REST GET ${path} failed: ${res.status}`);
  const payload = (await res.json()) as {
    fields?: Record<
      string,
      {
        booleanValue?: boolean;
        arrayValue?: {
          values?: Array<{
            mapValue?: { fields?: { full_name?: { stringValue?: string }; days?: { integerValue?: string; doubleValue?: number } } };
          }>;
        };
      }
    >;
  };
  const fields = payload.fields ?? {};
  const resultsPublic = fields["results_public"]?.booleanValue ?? false;
  const rawValues = fields["rows"]?.arrayValue?.values ?? [];
  const rows = rawValues.map((entry) => {
    const f = entry.mapValue?.fields;
    return {
      full_name: String(f?.["full_name"]?.stringValue ?? ""),
      days: Number(f?.["days"]?.integerValue ?? f?.["days"]?.doubleValue ?? 0),
    };
  });
  return { results_public: resultsPublic, rows };
}

export async function fetchPublicResultsFirestore(): Promise<{
  open: boolean;
  rows: { full_name: string; days: number }[];
}> {
  const settingsPath = "app_settings/global";
  try {
    const settingsSnap = await getDoc(doc(db, "app_settings", "global"));
    const open = settingsSnap.exists() ? Boolean(settingsSnap.data()["results_public"]) : false;
    if (!open) {
      return { open: false, rows: [] };
    }
    const pubSnap = await getDoc(doc(db, "public_results", "latest"));
    if (!pubSnap.exists()) {
      return { open: true, rows: [] };
    }
    const rawRows = pubSnap.data()["rows"];
    const rows = Array.isArray(rawRows)
      ? rawRows.map((r) => ({
          full_name: String((r as { full_name?: unknown })?.full_name ?? ""),
          days: Number((r as { days?: unknown })?.days ?? 0),
        }))
      : [];
    return { open: true, rows };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (msg.includes("offline") || msg.includes("unavailable")) {
      try {
        const settingsDoc = await fetchPublicDocViaRest("app_settings/global");
        const open = Boolean(settingsDoc?.["results_public"]);
        if (!open) return { open: false, rows: [] };
        const pubDoc = await fetchPublicDocViaRest("public_results/latest");
        const rows = Array.isArray(pubDoc?.["rows"])
          ? (pubDoc["rows"] as { full_name: string; days: number }[])
          : [];
        return { open: true, rows };
      } catch {
        return { open: false, rows: [] };
      }
    }
    handleFirestoreError(err, OperationType.GET, settingsPath);
  }
}

// --- Assistant Chats ---

export async function fetchAssistantChatFirestore<T = unknown>(): Promise<T[]> {
  const meta = getCurrentStaffMeta();
  const path = `assistant_chats/${meta.uid}`;
  try {
    const snap = await getDoc(doc(db, "assistant_chats", meta.uid));
    if (!snap.exists()) return [];
    const msgs = snap.data()["messages"];
    return Array.isArray(msgs) ? (msgs as T[]) : [];
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (msg.includes("offline") || msg.includes("unavailable")) {
      return [];
    }
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function clearAssistantChatFirestore(): Promise<void> {
  const meta = getCurrentStaffMeta();
  const path = `assistant_chats/${meta.uid}`;
  try {
    await deleteDoc(doc(db, "assistant_chats", meta.uid));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// --- Historical Attendance Import ---

export async function importHistoricalAttendanceFirestore(
  qc: QueryClient,
  rows: readonly HistoricalStudentSeed[] = HISTORICAL_NOV2026_SEED,
): Promise<{ studentsCreated: number; attendanceCreated: number }> {
  const caller = await resolveCallerDisplayInfo();
  if (caller.role !== "admin") {
    throw new Error("استيراد الكشف متاح للمدير فقط");
  }

  let studentSnap;
  try {
    studentSnap = await getDocs(collection(db, "students"));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, "students");
  }

  let attendanceSnap;
  try {
    attendanceSnap = await getDocs(collection(db, "attendance"));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, "attendance");
  }

  const byNorm = new Map<string, { id: string; full_name: string }>();
  for (const d of studentSnap.docs) {
    const data = d.data();
    const fullName = String(data["full_name"] ?? "");
    const norm = String(data["normalized_name"] ?? "") || validateStudentDisplayName(fullName).normalized_name;
    if (norm) byNorm.set(norm, { id: d.id, full_name: fullName });
  }

  const existingAttendanceIds = new Set(attendanceSnap.docs.map((d) => d.id));

  // Phase 1: Create any missing students via bounded single-document writes
  // so security rules never hit Firestore's 20-lookup-per-batch limit, and wait
  // for all student docs to commit before writing attendance docs that verify exists(/students/...).
  const pendingStudents: Array<{ ref: ReturnType<typeof doc>; full_name: string; normalized_name: string }> = [];
  for (const item of rows) {
    const checked = validateStudentDisplayName(item.fullName);
    if (!checked.valid) continue;
    if (!byNorm.has(checked.normalized_name)) {
      const ref = doc(collection(db, "students"));
      byNorm.set(checked.normalized_name, { id: ref.id, full_name: checked.full_name });
      pendingStudents.push({
        ref,
        full_name: checked.full_name,
        normalized_name: checked.normalized_name,
      });
    }
  }

  if (pendingStudents.length > 0) {
    try {
      await runInParallelChunks(pendingStudents, 15, (s) =>
        setDoc(s.ref, {
          full_name: s.full_name,
          normalized_name: s.normalized_name,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdByUid: caller.uid,
        }),
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, "students");
    }
  }

  // Phase 2: Create any missing attendance records via individual setDoc calls in parallel chunks
  // (each attendance create calls exists(/students/...) in firestore.rules, so batching >20 in one writeBatch
  // exceeds Firestore's 20 document-access calls per batch limit).
  const pendingAttendance: Array<{
    ref: ReturnType<typeof doc>;
    student_id: string;
    student_name: string;
    attended_on: string;
  }> = [];

  for (const item of rows) {
    const checked = validateStudentDisplayName(item.fullName);
    if (!checked.valid) continue;
    const student = byNorm.get(checked.normalized_name);
    if (!student) continue;

    for (const date of item.dates) {
      const docId = attendanceDocId(date, student.id);
      if (existingAttendanceIds.has(docId)) continue;
      existingAttendanceIds.add(docId);
      pendingAttendance.push({
        ref: doc(db, "attendance", docId),
        student_id: student.id,
        student_name: student.full_name.slice(0, STAFF_LIMITS.STUDENT_NAME_MAX),
        attended_on: date,
      });
    }
  }

  if (pendingAttendance.length > 0) {
    try {
      await runInParallelChunks(pendingAttendance, 15, (a) =>
        setDoc(a.ref, {
          student_id: a.student_id,
          student_name: a.student_name,
          attended_on: a.attended_on,
          recorded_by_uid: caller.uid,
          recorded_by_name: caller.name,
          recorded_by_email: caller.email,
          createdAt: serverTimestamp(),
        }),
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, "attendance");
    }
  }

  if (pendingStudents.length > 0 || pendingAttendance.length > 0) {
    await syncPublicResultsBestEffort();
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["students"] }),
      qc.invalidateQueries({ queryKey: ["attendance"] }),
      qc.invalidateQueries({ queryKey: ["student-attendance"] }),
      qc.invalidateQueries({ queryKey: ["public-results"] }),
    ]);
  }

  return {
    studentsCreated: pendingStudents.length,
    attendanceCreated: pendingAttendance.length,
  };
}
