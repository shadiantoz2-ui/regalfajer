import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { apiJson, setSessionBearerToken } from "./api-client";
import type {
  AttendanceRow,
  StaffAccountView,
  StaffRecordingItem,
  StaffRole,
  StaffSessionUser,
  Student,
} from "./types";

export type DayRow = { id: string; student_id: string; full_name: string; created_at: string };
export type RenameResult = { status: "renamed" | "invalid" } | { status: "duplicate"; existing: string };

export type AuthStateResponse = {
  needsSetup: boolean;
  user: StaffSessionUser | null;
  token?: string | null;
};

export async function fetchAuthState(): Promise<AuthStateResponse> {
  const res = await apiJson<AuthStateResponse>("/api/auth");
  setSessionBearerToken(res.user ? (res.token ?? null) : null);
  return res;
}

export async function setupPrimaryAdminAccount(input: {
  name: string;
  username: string;
  password: string;
}): Promise<StaffSessionUser> {
  const res = await apiJson<{ ok: true; user: StaffSessionUser; token?: string }>("/api/auth", {
    method: "POST",
    body: JSON.stringify({ action: "setup_primary_admin", ...input }),
  });
  setSessionBearerToken(res.token ?? null);
  return res.user;
}

export async function loginWithPassword(input: {
  username: string;
  password: string;
}): Promise<StaffSessionUser> {
  const res = await apiJson<{ ok: true; user: StaffSessionUser; token?: string }>("/api/auth", {
    method: "POST",
    body: JSON.stringify({ action: "login", ...input }),
  });
  setSessionBearerToken(res.token ?? null);
  return res.user;
}

export async function logoutSession(): Promise<void> {
  try {
    await apiJson<{ ok: true }>("/api/auth", {
      method: "POST",
      body: JSON.stringify({ action: "logout" }),
    });
  } finally {
    setSessionBearerToken(null);
  }
}

export const staffAccountsQuery = () =>
  queryOptions({
    queryKey: ["staff-accounts"],
    queryFn: async (): Promise<StaffAccountView[]> => {
      const res = await apiJson<{ accounts: StaffAccountView[] }>("/api/staff");
      return res.accounts;
    },
  });

export const myDayRecordingsQuery = (date: string) =>
  queryOptions({
    queryKey: ["my-day-recordings", date],
    queryFn: async (): Promise<StaffRecordingItem[]> => {
      const res = await apiJson<{ rows: StaffRecordingItem[] }>(
        `/api/staff?mode=my-recordings&date=${encodeURIComponent(date)}`,
      );
      return res.rows;
    },
    staleTime: 15_000,
  });

export const teacherDayRecordingsQuery = (staffId: string, date: string) =>
  queryOptions({
    queryKey: ["teacher-day-recordings", staffId, date],
    queryFn: async (): Promise<StaffRecordingItem[]> => {
      const res = await apiJson<{ rows: StaffRecordingItem[] }>(
        `/api/staff?mode=recordings&staffId=${encodeURIComponent(staffId)}&date=${encodeURIComponent(date)}`,
      );
      return res.rows;
    },
  });

export async function createStaffAccountApi(input: {
  name: string;
  username: string;
  password: string;
  role: StaffRole;
}): Promise<StaffAccountView> {
  const res = await apiJson<{ ok: true; account: StaffAccountView }>("/api/staff", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.account;
}

export async function updateStaffAccountApi(
  id: string,
  patch: { name?: string; role?: StaffRole; password?: string },
): Promise<StaffAccountView> {
  const res = await apiJson<{ ok: true; account: StaffAccountView }>("/api/staff", {
    method: "PATCH",
    body: JSON.stringify({ id, ...patch }),
  });
  return res.account;
}

export async function deleteStaffAccountApi(id: string): Promise<void> {
  await apiJson<{ ok: true }>("/api/staff", {
    method: "DELETE",
    body: JSON.stringify({ id }),
  });
}

export const studentsQuery = () =>
  queryOptions({
    queryKey: ["students"],
    queryFn: async (): Promise<Student[]> => {
      const res = await apiJson<{ students: Student[] }>("/api/students");
      return res.students;
    },
    staleTime: 60_000,
  });

export const dayAttendanceQuery = (date: string) =>
  queryOptions({
    queryKey: ["attendance", date],
    queryFn: async (): Promise<DayRow[]> => {
      const res = await apiJson<{ rows: DayRow[] }>(`/api/attendance?date=${encodeURIComponent(date)}`);
      return res.rows;
    },
    staleTime: 30_000,
  });

export const settingsQuery = () =>
  queryOptions({
    queryKey: ["settings"],
    queryFn: () => apiJson<{ results_public: boolean; teacher_entry_enabled: boolean }>("/api/settings"),
  });

export const teacherEntryQuery = () =>
  queryOptions({
    queryKey: ["teacher-entry"],
    queryFn: () => apiJson<{ teacher_entry_enabled: boolean }>("/api/settings?entry=1"),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

export const publicResultsQuery = () =>
  queryOptions({
    queryKey: ["public-results"],
    queryFn: () =>
      apiJson<{ open: boolean; rows: { full_name: string; days: number }[] }>("/api/settings?public=1"),
    refetchInterval: 30_000,
  });

export async function setResultsPublic(value: boolean) {
  await apiJson<{ ok: true; results_public: boolean; teacher_entry_enabled: boolean }>("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ results_public: value }),
  });
}

export async function setTeacherEntryEnabledApi(value: boolean) {
  await apiJson<{ ok: true; results_public: boolean; teacher_entry_enabled: boolean }>("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ teacher_entry_enabled: value }),
  });
}

export async function addStudent(
  rawName: string,
): Promise<
  | { status: "created"; student: Student }
  | { status: "duplicate"; existing: string; student: Student | null }
  | { status: "invalid" }
> {
  return apiJson("/api/students", {
    method: "POST",
    body: JSON.stringify({ fullName: rawName }),
  });
}

export async function addStudentsBulk(
  names: readonly string[],
): Promise<{ created: Student[]; duplicates: string[] }> {
  return apiJson("/api/students", {
    method: "POST",
    body: JSON.stringify({ mode: "bulk", names }),
  });
}

export const studentAttendanceQuery = (studentId: string) =>
  queryOptions({
    queryKey: ["student-attendance", studentId],
    queryFn: async (): Promise<AttendanceRow[]> => {
      const res = await apiJson<{ rows: AttendanceRow[] }>(
        `/api/attendance?studentId=${encodeURIComponent(studentId)}`,
      );
      return res.rows;
    },
  });

export async function renameStudent(id: string, rawName: string): Promise<RenameResult> {
  return apiJson<RenameResult>("/api/students", {
    method: "PATCH",
    body: JSON.stringify({ id, fullName: rawName }),
  });
}

export async function deleteStudent(id: string) {
  await apiJson<{ ok: true }>("/api/students", {
    method: "DELETE",
    body: JSON.stringify({ id }),
  });
}

export async function recordAttendance(
  qc: QueryClient,
  student: Student,
  date: string,
): Promise<"recorded" | "duplicate"> {
  const res = await apiJson<{ status: "recorded" | "duplicate" }>("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ mode: "single", studentId: student.id, date }),
  });

  if (res.status === "recorded") {
    const nowIso = new Date().toISOString();
    const optimisticRow: DayRow = {
      id: `${date}_${student.id}`,
      student_id: student.id,
      full_name: student.full_name,
      created_at: nowIso,
    };
    qc.setQueryData<DayRow[]>(["attendance", date], (prev) => {
      if (!prev) return prev;
      if (prev.some((r) => r.student_id === student.id)) return prev;
      return [optimisticRow, ...prev];
    });
  }

  void qc.invalidateQueries({ queryKey: ["attendance", date] });
  void qc.invalidateQueries({ queryKey: ["my-day-recordings", date] });
  void qc.invalidateQueries({ queryKey: ["student-attendance", student.id] });
  void qc.invalidateQueries({ queryKey: ["public-results"] });
  return res.status;
}

export async function recordAttendanceBulk(
  qc: QueryClient,
  studentIds: string[],
  date: string,
): Promise<{ recorded: number; skipped: number }> {
  const res = await apiJson<{ recorded: number; skipped: number }>("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ mode: "bulk", studentIds, date }),
  });
  void qc.invalidateQueries({ queryKey: ["attendance", date] });
  void qc.invalidateQueries({ queryKey: ["my-day-recordings", date] });
  void qc.invalidateQueries({ queryKey: ["student-attendance"] });
  void qc.invalidateQueries({ queryKey: ["public-results"] });
  return res;
}

export async function deleteAttendance(id: string) {
  await apiJson<{ ok: true }>("/api/attendance", {
    method: "DELETE",
    body: JSON.stringify({ id }),
  });
}

export async function fetchAllAttendance(from?: string, to?: string): Promise<AttendanceRow[]> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const res = await apiJson<{ rows: AttendanceRow[] }>(`/api/attendance${qs ? `?${qs}` : ""}`);
  return res.rows;
}

export async function recordStudentPastDates(
  qc: QueryClient,
  student: Student,
  dates: readonly string[],
  maxDate: string,
): Promise<{ recorded: number; skipped: number }> {
  const res = await apiJson<{ recorded: number; skipped: number }>("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ mode: "past_dates", studentId: student.id, dates, maxDate }),
  });
  void qc.invalidateQueries({ queryKey: ["attendance"] });
  void qc.invalidateQueries({ queryKey: ["student-attendance", student.id] });
  void qc.invalidateQueries({ queryKey: ["public-results"] });
  return res;
}
