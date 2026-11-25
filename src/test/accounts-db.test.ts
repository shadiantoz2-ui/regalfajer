import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authenticateStaffCredentials,
  buildSessionCookieHeader,
  createStaffAccount,
  deleteStaffAccount,
  hasAnyStaffAccount,
  listStaffAccounts,
  resolveSession,
  SESSION_COOKIE_NAME,
  setupPrimaryAdmin,
  signSessionToken,
  updateStaffAccount,
} from "@/lib/server/auth.server";
import {
  addStudent,
  getAssistantChatMessages,
  getPublicLeaderboard,
  listAllAttendance,
  listStaffDayRecordings,
  listStudents,
  recordAttendance,
  setResultsPublic,
  upsertAssistantChatMessages,
} from "@/lib/server/data.server";
import { closeDbForTesting } from "@/lib/server/db.server";

let tempDir = "";
let tempDbPath = "";

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "rijal-db-test-"));
  tempDbPath = path.join(tempDir, "test.db");
  process.env["RIJAL_DB_PATH"] = tempDbPath;
});

afterEach(() => {
  closeDbForTesting(tempDbPath);
  delete process.env["RIJAL_DB_PATH"];
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("Separate Staff Accounts & Attendance SQLite Database", () => {
  it("auto-seeds the 72 November 2026 students and attendance records on first open", () => {
    expect(hasAnyStaffAccount()).toBe(false);
    const students = listStudents();
    const attendance = listAllAttendance();
    expect(students.length).toBe(72);
    expect(attendance.length).toBeGreaterThan(200);
  });

  it("allows setting up primary admin once and rejects duplicate setup", () => {
    const first = setupPrimaryAdmin({
      name: "أبو عبد الله",
      username: "Admin1",
      password: "secret-password-1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("Expected primary admin creation to succeed");
    expect(first.user.role).toBe("admin");
    expect(first.user.isPrimaryAdmin).toBe(true);
    expect(first.user.username).toBe("admin1");
    expect(hasAnyStaffAccount()).toBe(true);

    const second = setupPrimaryAdmin({
      name: "مستخدم آخر",
      username: "admin2",
      password: "another-password",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.status).toBe(409);
    }
  });

  it("authenticates primary admin, creates teacher, updates password, and deletes account", () => {
    const adminRes = setupPrimaryAdmin({
      name: "المدير الأساسي",
      username: "main_admin",
      password: "Password123!",
    });
    if (!adminRes.ok) throw new Error("Setup failed");
    const adminId = adminRes.user.id;

    // Create teacher
    const teacherRes = createStaffAccount(adminId, {
      name: "خالد العتيبي",
      username: "khaled",
      password: "initial-pass-1",
      role: "teacher",
    });
    expect(teacherRes.ok).toBe(true);
    if (!teacherRes.ok) throw new Error("Teacher create failed");
    const teacherId = teacherRes.account.id;

    // Duplicate username rejected
    const dupRes = createStaffAccount(adminId, {
      name: "مكرر",
      username: "KHALED",
      password: "some-password",
      role: "teacher",
    });
    expect(dupRes.ok).toBe(false);

    // Login with initial password
    expect(authenticateStaffCredentials({ username: "khaled", password: "wrong" })).toBeNull();
    const loggedInTeacher = authenticateStaffCredentials({ username: "khaled", password: "initial-pass-1" });
    expect(loggedInTeacher?.name).toBe("خالد العتيبي");
    expect(loggedInTeacher?.role).toBe("teacher");

    // Admin updates teacher display name + password
    const updatedRes = updateStaffAccount(adminId, teacherId, {
      name: "الأستاذ خالد السالم",
      password: "new-password-99",
    });
    expect(updatedRes.ok).toBe(true);

    // Old password rejected, new password works with updated name
    expect(authenticateStaffCredentials({ username: "khaled", password: "initial-pass-1" })).toBeNull();
    const relogin = authenticateStaffCredentials({ username: "khaled", password: "new-password-99" });
    expect(relogin?.name).toBe("الأستاذ خالد السالم");

    // Primary admin cannot be deleted or demoted
    expect(deleteStaffAccount(adminId, adminId).ok).toBe(false);
    expect(updateStaffAccount(adminId, adminId, { role: "teacher" }).ok).toBe(false);

    // Valid cookie resolves live user, and deletion immediately invalidates the cookie
    const token = signSessionToken(teacherId);
    const req = new Request("http://localhost:3000/api/staff", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
    });
    expect(resolveSession(req)?.id).toBe(teacherId);

    expect(deleteStaffAccount(adminId, teacherId).ok).toBe(true);
    expect(resolveSession(req)).toBeNull();
    expect(listStaffAccounts().map((a) => a.id)).toEqual([adminId]);
  });

  it("tracks per-teacher check-ins, gates public leaderboard, and persists assistant chats", () => {
    const adminRes = setupPrimaryAdmin({
      name: "المدير",
      username: "boss",
      password: "Password123!",
    });
    if (!adminRes.ok) throw new Error("Setup failed");

    const tRes = createStaffAccount(adminRes.user.id, {
      name: "معلم الفجر",
      username: "fajr_t",
      password: "Password123!",
      role: "teacher",
    });
    if (!tRes.ok) throw new Error("Teacher failed");

    const teacherSession = {
      id: tRes.account.id,
      name: tRes.account.name,
      username: tRes.account.username,
      role: tRes.account.role,
      isPrimaryAdmin: false,
    };

    const added = addStudent("عبد الرحمن الشهري", teacherSession.id);
    expect(added.status).toBe("created");
    if (added.status !== "created") throw new Error("Student add failed");

    const rec = recordAttendance(added.student.id, "2026-11-26", teacherSession);
    expect(rec.status).toBe("recorded");
    expect(recordAttendance(added.student.id, "2026-11-26", teacherSession).status).toBe("duplicate");

    const myRows = listStaffDayRecordings(teacherSession.id, "2026-11-26");
    expect(myRows.length).toBe(1);
    expect(myRows[0]?.studentName).toBe("عبد الرحمن الشهري");

    expect(getPublicLeaderboard().open).toBe(false);
    setResultsPublic(true, adminRes.user.id);
    const pub = getPublicLeaderboard();
    expect(pub.open).toBe(true);
    expect(pub.rows.length).toBe(73);

    upsertAssistantChatMessages(adminRes.user.id, [{ id: "m1", role: "user", parts: [{ type: "text", text: "مرحبا" }] }]);
    expect(getAssistantChatMessages(adminRes.user.id)).toHaveLength(1);
  });

  it("authenticates via Bearer token even when cookies are absent and marks HTTPS Origin cookies SameSite=None; Partitioned", () => {
    const adminRes = setupPrimaryAdmin({
      name: "المدير",
      username: "iframe_admin",
      password: "Password123!",
    });
    if (!adminRes.ok) throw new Error("Setup failed");

    const token = signSessionToken(adminRes.user.id);
    const bearerReq = new Request("http://127.0.0.1:3000/api/students", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resolveSession(bearerReq)?.id).toBe(adminRes.user.id);

    const proxiedHttpsReq = new Request("http://127.0.0.1:3000/api/auth", {
      method: "POST",
      headers: { Origin: "https://ais-dev-example.europe-west2.run.app" },
    });
    const cookieHeader = buildSessionCookieHeader(proxiedHttpsReq, token);
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("Secure");
    expect(cookieHeader).toContain("SameSite=None");
    expect(cookieHeader).toContain("Partitioned");
  });
});
