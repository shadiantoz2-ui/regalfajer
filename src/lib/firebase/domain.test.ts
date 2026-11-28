import { describe, expect, it } from "vitest";
import {
  attendanceDocId,
  canRoleEnterData,
  computePublicLeaderboard,
  emailDocKey,
  normalizePastAttendanceDates,
  resolveRoleForAccount,
  STAFF_LIMITS,
  validateStaffAccountInput,
} from "./domain";

describe("Firebase Staff & Attendance Domain", () => {
  it("produces safe Firestore IDs matching firestore.rules", () => {
    expect(emailDocKey("Teacher.One@rijal-alfajr.app ")).toBe("teacher_one_rijal_alfajr_app");
    expect(emailDocKey("ahmad+fajr@gmail.com")).toMatch(STAFF_LIMITS.ID_PATTERN);
  });

  it("produces deterministic date_student attendance IDs", () => {
    expect(attendanceDocId("2026-11-24", "stu_1")).toBe("2026-11-24_stu_1");
    expect(attendanceDocId("2026-11-24", "stu_1")).toMatch(STAFF_LIMITS.ID_PATTERN);
  });

  it("grants teacher or admin only when UID and email match staff profile doc", () => {
    expect(
      resolveRoleForAccount("uid-1", "teacher1@rijal-alfajr.app", {
        uid: "uid-1",
        email: "teacher1@rijal-alfajr.app",
        role: "teacher",
      }),
    ).toBe("teacher");
    expect(
      resolveRoleForAccount("uid-2", "admin@rijal-alfajr.app", {
        uid: "uid-2",
        email: "admin@rijal-alfajr.app",
        role: "admin",
      }),
    ).toBe("admin");
    expect(
      resolveRoleForAccount("uid-attacker", "other@rijal-alfajr.app", {
        uid: "uid-2",
        email: "admin@rijal-alfajr.app",
        role: "admin",
      }),
    ).toBeNull();
    expect(resolveRoleForAccount("uid-3", "unknown@rijal-alfajr.app", null)).toBeNull();
  });

  it("validates staff username, password, and display name against blueprint limits", () => {
    expect(
      validateStaffAccountInput({
        name: "  أحمد   المعلم  ",
        username: "Ahmad.1",
        password: "secret123",
        role: "teacher",
      }),
    ).toEqual({
      ok: true,
      name: "أحمد المعلم",
      username: "ahmad.1",
      email: "ahmad.1@rijal-alfajr.app",
      role: "teacher",
    });

    expect(
      validateStaffAccountInput({ name: "أ", username: "ahmad", password: "secret123", role: "teacher" }).ok,
    ).toBe(false);
    expect(
      validateStaffAccountInput({ name: "أحمد", username: "a b", password: "secret123", role: "admin" }).ok,
    ).toBe(false);
    expect(
      validateStaffAccountInput({ name: "أحمد", username: "ahmad", password: "123", role: "admin" }).ok,
    ).toBe(false);
    expect(
      validateStaffAccountInput({ name: "أحمد", username: "ahmad", role: "admin", requirePassword: false }).ok,
    ).toBe(true);
  });

  it("computes public leaderboard sorted descending by days then Arabic name", () => {
    const rows = computePublicLeaderboard(
      [
        { id: "s1", full_name: "بدر العتيبي" },
        { id: "s2", full_name: "أحمد القحطاني" },
        { id: "s3", full_name: "خالد الدوسري" },
      ],
      [{ student_id: "s1" }, { student_id: "s2" }, { student_id: "s2" }, { student_id: "s3" }],
    );
    expect(rows).toEqual([
      { full_name: "أحمد القحطاني", days: 2 },
      { full_name: "بدر العتيبي", days: 1 },
      { full_name: "خالد الدوسري", days: 1 },
    ]);
  });

  it("normalizes, sorts, and filters past attendance dates against maxDate and existing records", () => {
    const existing = new Set(["2026-11-22", "2026-11-24"]);
    const res = normalizePastAttendanceDates(
      ["2026-11-23", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-29", "invalid"],
      "2026-11-24",
      existing,
    );
    expect(res).toEqual({
      validDates: ["2026-11-21", "2026-11-23"],
      skippedCount: 1,
    });
  });

  it("enforces teacher data entry toggle while always allowing admins", () => {
    expect(canRoleEnterData("admin", true)).toBe(true);
    expect(canRoleEnterData("admin", false)).toBe(true);
    expect(canRoleEnterData("teacher", true)).toBe(true);
    expect(canRoleEnterData("teacher", false)).toBe(false);
  });
});
