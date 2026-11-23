import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cleanDisplayName, normalizeName } from "./arabic";

import type { AttendanceRow, Student } from "./types";

const UNIQUE_VIOLATION = "23505";

export async function listStudentsDb(): Promise<Student[]> {
  const all: Student[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("students")
      .select("id, full_name, created_at")
      .order("full_name")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

export async function addStudentDb(rawName: string) {
  const full_name = cleanDisplayName(rawName);
  const normalized_name = normalizeName(full_name);
  if (!normalized_name) return { status: "invalid" as const };
  const { data, error } = await supabaseAdmin
    .from("students")
    .insert({ full_name, normalized_name })
    .select("id, full_name, created_at")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const { data: existing } = await supabaseAdmin
        .from("students")
        .select("id, full_name, created_at")
        .eq("normalized_name", normalized_name)
        .maybeSingle();
      return { status: "duplicate" as const, student: existing as Student | null };
    }
    throw new Error(error.message);
  }
  return { status: "created" as const, student: data as Student };
}

export async function deleteStudentDb(id: string) {
  const { error } = await supabaseAdmin.from("students").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function recordAttendanceDb(studentId: string, date: string) {
  const { data, error } = await supabaseAdmin
    .from("attendance")
    .insert({ student_id: studentId, attended_on: date })
    .select("id, student_id, attended_on, created_at")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { status: "duplicate" as const };
    throw new Error(error.message);
  }
  return { status: "recorded" as const, row: data as AttendanceRow };
}

export async function deleteAttendanceDb(id: string) {
  const { error } = await supabaseAdmin.from("attendance").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function attendanceForDateDb(date: string) {
  const { data, error } = await supabaseAdmin
    .from("attendance")
    .select("id, student_id, attended_on, created_at, students(full_name)")
    .eq("attended_on", date)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    student_id: r.student_id,
    attended_on: r.attended_on,
    created_at: r.created_at,
    full_name: (r.students as { full_name: string } | null)?.full_name ?? "",
  }));
}

export async function allAttendanceDb(from?: string, to?: string): Promise<AttendanceRow[]> {
  const all: AttendanceRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    let q = supabaseAdmin
      .from("attendance")
      .select("id, student_id, attended_on, created_at")
      .order("attended_on")
      .range(offset, offset + 999);
    if (from) q = q.gte("attended_on", from);
    if (to) q = q.lte("attended_on", to);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return all;
}
