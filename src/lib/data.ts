/** Direct reads/writes through the signed-in browser client: one hop, protected by row-level rules. */
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cleanDisplayName, normalizeName } from "./arabic";
import type { AttendanceRow, Student } from "./types";

const UNIQUE_VIOLATION = "23505";

export type DayRow = AttendanceRow & { full_name: string };

async function fetchStudents(): Promise<Student[]> {
  const all: Student[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("students")
      .select("id, full_name, created_at")
      .order("full_name")
      .range(from, from + 999);
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

async function fetchDay(date: string): Promise<DayRow[]> {
  const { data, error } = await supabase
    .from("attendance")
    .select("id, student_id, attended_on, created_at, students(full_name)")
    .eq("attended_on", date)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    student_id: r.student_id,
    attended_on: r.attended_on,
    created_at: r.created_at,
    full_name: (r.students as { full_name: string } | null)?.full_name ?? "",
  }));
}

export const studentsQuery = () =>
  queryOptions({ queryKey: ["students"], queryFn: fetchStudents, staleTime: 60_000 });

export const dayAttendanceQuery = (date: string) =>
  queryOptions({ queryKey: ["attendance", date], queryFn: () => fetchDay(date), staleTime: 30_000 });

export const settingsQuery = () =>
  queryOptions({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("results_public").eq("id", 1).maybeSingle();
      if (error) throw error;
      return { results_public: data?.results_public ?? false };
    },
  });

export const publicResultsQuery = () =>
  queryOptions({
    queryKey: ["public-results"],
    queryFn: async () => {
      const [{ data: settings }, { data, error }] = await Promise.all([
        supabase.from("app_settings").select("results_public").eq("id", 1).maybeSingle(),
        supabase.rpc("public_results"),
      ]);
      if (error) throw error;
      return { open: settings?.results_public ?? false, rows: (data ?? []) as { full_name: string; days: number }[] };
    },
    refetchInterval: 30_000,
  });

export async function setResultsPublic(value: boolean) {
  const { error } = await supabase
    .from("app_settings")
    .update({ results_public: value, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw error;
}

export async function addStudent(rawName: string) {
  const full_name = cleanDisplayName(rawName);
  const normalized_name = normalizeName(full_name);
  if (!normalized_name) return { status: "invalid" as const };
  const { data, error } = await supabase
    .from("students")
    .insert({ full_name, normalized_name })
    .select("id, full_name, created_at")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const { data: existing } = await supabase
        .from("students")
        .select("id, full_name, created_at")
        .eq("normalized_name", normalized_name)
        .maybeSingle();
      return { status: "duplicate" as const, student: (existing as Student | null) ?? null };
    }
    throw error;
  }
  return { status: "created" as const, student: data as Student };
}

export type RenameResult = { status: "renamed" | "invalid" } | { status: "duplicate"; existing: string };

/** Admin only (enforced by row-level rules). Same duplicate rule as adding. */
export async function renameStudent(id: string, rawName: string): Promise<RenameResult> {
  const full_name = cleanDisplayName(rawName);
  const normalized_name = normalizeName(full_name);
  if (!normalized_name || full_name.split(" ").length < 2) return { status: "invalid" };
  const { error } = await supabase.from("students").update({ full_name, normalized_name }).eq("id", id);
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const { data: existing } = await supabase
        .from("students")
        .select("full_name")
        .eq("normalized_name", normalized_name)
        .maybeSingle();
      return { status: "duplicate", existing: existing?.full_name ?? full_name };
    }
    throw error;
  }
  return { status: "renamed" };
}

export async function deleteStudent(id: string) {
  const { error } = await supabase.from("students").delete().eq("id", id);
  if (error) throw error;
}

/** Records attendance and updates the day's list immediately (before the live update arrives). */
export async function recordAttendance(qc: QueryClient, student: Student, date: string) {
  const { data, error } = await supabase
    .from("attendance")
    .insert({ student_id: student.id, attended_on: date })
    .select("id, student_id, attended_on, created_at")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return "duplicate" as const;
    throw error;
  }
  qc.setQueryData<DayRow[]>(["attendance", date], (old) =>
    old && !old.some((r) => r.id === data.id) ? [{ ...data, full_name: student.full_name }, ...old] : old,
  );
  return "recorded" as const;
}

/** Records many students for one date; students already recorded that day are skipped, never doubled. */
export async function recordAttendanceBulk(qc: QueryClient, studentIds: string[], date: string) {
  const ids = [...new Set(studentIds)];
  if (!ids.length) return { recorded: 0, skipped: 0 };
  const { data, error } = await supabase
    .from("attendance")
    .upsert(
      ids.map((student_id) => ({ student_id, attended_on: date })),
      { onConflict: "student_id,attended_on", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw error;
  const recorded = data?.length ?? 0;
  await qc.invalidateQueries({ queryKey: ["attendance", date] });
  return { recorded, skipped: ids.length - recorded };
}

export async function deleteAttendance(id: string) {
  const { error } = await supabase.from("attendance").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchAllAttendance(from?: string, to?: string): Promise<AttendanceRow[]> {
  const all: AttendanceRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    let q = supabase
      .from("attendance")
      .select("id, student_id, attended_on, created_at")
      .order("attended_on")
      .range(offset, offset + 999);
    if (from) q = q.gte("attended_on", from);
    if (to) q = q.lte("attended_on", to);
    const { data, error } = await q;
    if (error) throw error;
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return all;
}
