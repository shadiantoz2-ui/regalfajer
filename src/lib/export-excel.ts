import type { AttendanceRow, Student } from "./types";
import { formatDateShort } from "./arabic";

/** Build an RTL Excel workbook: a students × days grid plus a per-student list of days. */
export async function downloadAttendanceExcel(students: Student[], attendance: AttendanceRow[], label: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "رجال الفجر";

  const dates = [...new Set(attendance.map((a) => a.attended_on))].sort();
  const byStudent = new Map<string, Set<string>>();
  for (const a of attendance) {
    const set = byStudent.get(a.student_id) ?? new Set<string>();
    set.add(a.attended_on);
    byStudent.set(a.student_id, set);
  }

  const gold = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC89B3C" } } as const;
  const green = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD8F0DF" } } as const;

  // Sheet 1: grid
  const grid = wb.addWorksheet("جدول الحضور", { views: [{ rightToLeft: true, state: "frozen", xSplit: 3, ySplit: 1 }] });
  grid.columns = [
    { header: "#", key: "n", width: 6 },
    { header: "الاسم الثلاثي", key: "name", width: 32 },
    { header: "عدد أيام الحضور", key: "total", width: 16 },
    ...dates.map((d) => ({ header: `${formatDateShort(d)}\n${d}`, key: d, width: 14 })),
  ];
  students.forEach((s, i) => {
    const days = byStudent.get(s.id) ?? new Set<string>();
    const row: Record<string, string | number> = { n: i + 1, name: s.full_name, total: days.size };
    for (const d of dates) row[d] = days.has(d) ? "✓" : "";
    const r = grid.addRow(row);
    dates.forEach((d, j) => {
      if (days.has(d)) r.getCell(4 + j).fill = green;
    });
  });
  const header = grid.getRow(1);
  header.height = 36;
  header.font = { bold: true, color: { argb: "FF141A2E" } };
  header.fill = gold;
  grid.eachRow((row) => {
    row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    row.getCell(2).alignment = { horizontal: "right", vertical: "middle" };
  });

  // Sheet 2: per-student list
  const list = wb.addWorksheet("أيام حضور كل طالب", { views: [{ rightToLeft: true }] });
  list.columns = [
    { header: "#", key: "n", width: 6 },
    { header: "الاسم الثلاثي", key: "name", width: 32 },
    { header: "عدد الأيام", key: "total", width: 12 },
    { header: "الأيام التي حضر بها", key: "days", width: 90 },
  ];
  students.forEach((s, i) => {
    const days = [...(byStudent.get(s.id) ?? [])].sort();
    list.addRow({ n: i + 1, name: s.full_name, total: days.length, days: days.join("   ،   ") });
  });
  list.getRow(1).font = { bold: true, color: { argb: "FF141A2E" } };
  list.getRow(1).fill = gold;
  list.eachRow((row) => {
    row.alignment = { vertical: "middle", wrapText: true, horizontal: "right" };
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `حضور-رجال-الفجر-${label}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
