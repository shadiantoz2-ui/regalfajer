import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  attendanceDocId,
  emailDocKey,
  resolveRoleForAccount,
  STAFF_LIMITS,
  validateStaffAccountInput,
} from "./src/lib/firebase/domain.ts";

const rules = readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8");
const blueprint = JSON.parse(readFileSync(resolve(process.cwd(), "firebase-blueprint.json"), "utf8")) as {
  entities: Record<string, { properties: Record<string, unknown>; required: string[] }>;
  firestore: Record<string, { entity: string }>;
};

test("denies all access by default with an explicit global catch-all", () => {
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
});

test("enforces one-time atomic first-admin bootstrap without any hardcoded email", () => {
  assert.ok(!rules.includes("shadiantoz171@gmail.com"));
  assert.ok(rules.includes("isInitialAdminBootstrap()"));
  assert.ok(rules.includes("!exists(/databases/$(database)/documents/app_settings/bootstrap)"));
  assert.ok(rules.includes("existsAfter(/databases/$(database)/documents/app_settings/bootstrap)"));
  assert.ok(
    rules.includes("getAfter(/databases/$(database)/documents/app_settings/bootstrap).data.adminUid == request.auth.uid"),
  );
  assert.ok(rules.includes("isValidBootstrapConfig(incoming())"));
});

test("blocks privilege escalation and ghost fields across all entities", () => {
  for (const fn of [
    "isValidStaffAccount",
    "isValidStaffProfile",
    "isValidBootstrapConfig",
    "isValidStudent",
    "isValidAttendance",
    "isValidAppSettings",
    "isValidPublicResults",
    "isValidAssistantChat",
  ]) {
    assert.ok(rules.includes(fn), `missing validator ${fn}`);
  }
  assert.ok(rules.includes(".keys().hasAll("));
  assert.ok(rules.includes(".keys().hasOnly("));
  assert.ok(rules.includes("affectedKeys().hasOnly("));
});

test("protects primary admin and current admin from self-deletion or demotion", () => {
  assert.ok(rules.includes("isPrimaryBootstrapAdmin("));
  assert.ok(rules.includes("existing().uid != request.auth.uid"));
  assert.ok(rules.includes("userId != request.auth.uid"));
});

test("enforces relational integrity on attendance and scopes teacher list queries", () => {
  assert.ok(rules.includes("exists(/databases/$(database)/documents/students/$(incoming().student_id))"));
  assert.ok(rules.includes("data.recorded_by_uid == request.auth.uid"));
  assert.ok(rules.includes("isTeacher() && existing().recorded_by_uid == request.auth.uid"));
  assert.ok(rules.includes("allow update: if false;"));
});

test("protects public_results and app_settings against unauthorized writes or scraping", () => {
  assert.ok(rules.includes("(resource != null && existing().results_public == true) || isStaff()"));
  assert.ok(rules.includes("allow list: if false;"));
  assert.ok(
    rules.includes(
      "incoming().results_public == get(/databases/$(database)/documents/app_settings/global).data.results_public",
    ),
  );
});

test("allows verified staff to list students without unfiltered resource.data blockers", () => {
  const studentsBlock = rules.match(/match \/students\/\{studentId\} \{[\s\S]*?\n {4}\}/)?.[0] ?? "";
  assert.ok(studentsBlock.includes("allow list: if isStaff();"));
  assert.ok(!studentsBlock.includes("existing().full_name"));
});

test("keeps firebase-blueprint.json collections aligned with firestore.rules", () => {
  const paths = Object.keys(blueprint.firestore);
  for (const expected of [
    "/staff_accounts/{accountId}",
    "/staff_profiles/{userId}",
    "/students/{studentId}",
    "/attendance/{attendanceId}",
    "/app_settings/{settingId}",
    "/public_results/{docId}",
    "/assistant_chats/{userId}",
  ]) {
    assert.ok(paths.includes(expected), `missing blueprint path ${expected}`);
  }
  assert.ok(Boolean(blueprint.entities["BootstrapConfig"]), "missing BootstrapConfig entity");
});

test("pure domain helpers enforce Firestore ID safety and RBAC boundaries", () => {
  assert.equal(emailDocKey("Teacher.One@rijal-alfajr.app "), "teacher_one_rijal_alfajr_app");
  assert.match(attendanceDocId("2026-11-24", "stu_1"), STAFF_LIMITS.ID_PATTERN);
  assert.equal(
    resolveRoleForAccount("u1", "admin@rijal-alfajr.app", {
      uid: "u1",
      email: "admin@rijal-alfajr.app",
      role: "admin",
    }),
    "admin",
  );
  assert.equal(
    resolveRoleForAccount("attacker-uid", "attacker@rijal-alfajr.app", {
      uid: "u1",
      email: "admin@rijal-alfajr.app",
      role: "admin",
    }),
    null,
  );
  assert.equal(
    validateStaffAccountInput({
      name: "أحمد",
      username: "ahmad",
      password: "password123",
      role: "teacher",
    }).ok,
    true,
  );
});

test("bulk Firestore writers avoid the 20-lookup-per-batch security-rule limit", () => {
  const apiSource = readFileSync(resolve(process.cwd(), "src/lib/firebase/firestore-api.ts"), "utf8");
  assert.ok(!apiSource.includes("BATCH_LIMIT = 400"));
  assert.ok(apiSource.includes("runInParallelChunks"));
  assert.ok(apiSource.includes("DELETE_BATCH_LIMIT = 5"));
});
