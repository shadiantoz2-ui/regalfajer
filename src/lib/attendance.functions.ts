import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import {
  addStudentDb,
  allAttendanceDb,
  attendanceForDateDb,
  deleteAttendanceDb,
  deleteStudentDb,
  listStudentsDb,
  recordAttendanceDb,
} from "./attendance.server";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const listStudents = createServerFn({ method: "GET" }).handler(() => listStudentsDb());

export const addStudent = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ full_name: z.string().trim().min(2).max(120) }).parse(d))
  .handler(({ data }) => addStudentDb(data.full_name));

export const addStudentsBulk = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ names: z.array(z.string().trim().min(2).max(120)).max(500) }).parse(d))
  .handler(async ({ data }) => {
    const created: string[] = [];
    const duplicates: string[] = [];
    for (const name of data.names) {
      const res = await addStudentDb(name);
      if (res.status === "created") created.push(res.student.full_name);
      else if (res.status === "duplicate") duplicates.push(name);
    }
    return { created, duplicates };
  });

export const deleteStudent = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await deleteStudentDb(data.id);
    return { ok: true };
  });

export const recordAttendance = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ student_id: z.string().uuid(), date: dateKey }).parse(d))
  .handler(({ data }) => recordAttendanceDb(data.student_id, data.date));

export const deleteAttendance = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await deleteAttendanceDb(data.id);
    return { ok: true };
  });

export const attendanceForDate = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ date: dateKey }).parse(d))
  .handler(({ data }) => attendanceForDateDb(data.date));

export const exportAttendance = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ from: dateKey.optional(), to: dateKey.optional() }).parse(d))
  .handler(async ({ data }) => {
    const [students, attendance] = await Promise.all([listStudentsDb(), allAttendanceDb(data.from, data.to)]);
    return { students, attendance };
  });

export const studentsQuery = () =>
  queryOptions({ queryKey: ["students"], queryFn: () => listStudents(), staleTime: 30_000 });

export const dayAttendanceQuery = (date: string) =>
  queryOptions({ queryKey: ["attendance", date], queryFn: () => attendanceForDate({ data: { date } }) });
