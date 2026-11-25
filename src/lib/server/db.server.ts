import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { cleanDisplayName, normalizeName } from "@/lib/arabic";
import { HISTORICAL_NOV2026_SEED } from "@/lib/seed-nov2026";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const dbInstances = new Map<string, DatabaseSyncType>();

export function resolveDbPath(): string {
  const override = process.env["RIJAL_DB_PATH"]?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.resolve(process.cwd(), ".data", "rijal-alfajr.db");
}

function initializeSchema(db: DatabaseSyncType): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS staff_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'teacher')),
      is_primary_admin INTEGER NOT NULL DEFAULT 0,
      created_by_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      created_by_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      student_name TEXT NOT NULL,
      attended_on TEXT NOT NULL,
      recorded_by_id TEXT NOT NULL,
      recorded_by_name TEXT NOT NULL,
      recorded_by_username TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(student_id, attended_on)
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(attended_on);
    CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_recorder_date ON attendance(recorded_by_id, attended_on);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by_id TEXT
    );

    CREATE TABLE IF NOT EXISTS assistant_chats (
      user_id TEXT PRIMARY KEY REFERENCES staff_accounts(id) ON DELETE CASCADE,
      messages TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO app_settings (key, value, updated_at, updated_by_id) VALUES (?, ?, ?, ?)`,
  ).run("results_public", "false", nowIso, null);

  seedHistoricalDataIfFresh(db);
}

function seedHistoricalDataIfFresh(db: DatabaseSyncType): void {
  const seededFlag = db
    .prepare(`SELECT value FROM system_config WHERE key = ?`)
    .get("nov2026_seeded") as { value?: string } | undefined;
  if (seededFlag?.value === "1") return;

  const studentCountRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM students`)
    .get() as { cnt: number };
  if (studentCountRow.cnt > 0) {
    db.prepare(`INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)`).run("nov2026_seeded", "1");
    return;
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const existingFlag = db
      .prepare(`SELECT value FROM system_config WHERE key = ?`)
      .get("nov2026_seeded") as { value?: string } | undefined;
    if (existingFlag?.value === "1") {
      db.exec("COMMIT");
      return;
    }

    const insertStudent = db.prepare(
      `INSERT OR IGNORE INTO students (id, full_name, normalized_name, created_by_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const findStudent = db.prepare(`SELECT id, full_name FROM students WHERE normalized_name = ?`);
    const insertAttendance = db.prepare(
      `INSERT OR IGNORE INTO attendance (
        id, student_id, student_name, attended_on, recorded_by_id, recorded_by_name, recorded_by_username, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const nowIso = new Date().toISOString();
    for (const item of HISTORICAL_NOV2026_SEED) {
      const fullName = cleanDisplayName(item.fullName);
      const normalized = normalizeName(fullName);
      if (!fullName || !normalized) continue;

      let studentRow = findStudent.get(normalized) as { id: string; full_name: string } | undefined;
      if (!studentRow) {
        const id = randomUUID();
        insertStudent.run(id, fullName, normalized, "system_seed", nowIso, nowIso);
        studentRow = { id, full_name: fullName };
      }

      for (const attendedOn of item.dates) {
        const attId = `${attendedOn}_${studentRow.id}`;
        insertAttendance.run(
          attId,
          studentRow.id,
          studentRow.full_name,
          attendedOn,
          "system_seed",
          "سجل الإدارة",
          "system",
          `${attendedOn}T04:30:00.000Z`,
        );
      }
    }

    db.prepare(`INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)`).run("nov2026_seeded", "1");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getDb(): DatabaseSyncType {
  const dbPath = resolveDbPath();
  const cached = dbInstances.get(dbPath);
  if (cached) return cached;

  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  initializeSchema(db);
  dbInstances.set(dbPath, db);
  return db;
}

export function getOrCreateSessionSecret(): string {
  const envSecret = process.env["SESSION_SECRET"]?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }
  const db = getDb();
  const row = db
    .prepare(`SELECT value FROM system_config WHERE key = ?`)
    .get("session_secret") as { value?: string } | undefined;
  if (row?.value && row.value.length >= 32) {
    return row.value;
  }

  const generated = randomBytes(32).toString("hex");
  db.prepare(`INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)`).run("session_secret", generated);
  const stored = db
    .prepare(`SELECT value FROM system_config WHERE key = ?`)
    .get("session_secret") as { value?: string } | undefined;
  return stored?.value || generated;
}

export function closeDbForTesting(targetPath?: string): void {
  const dbPath = targetPath ? path.resolve(targetPath) : resolveDbPath();
  const instance = dbInstances.get(dbPath);
  if (instance) {
    instance.close();
    dbInstances.delete(dbPath);
  }
}
