import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { STAFF_LIMITS, validateStaffAccountInput } from "@/lib/firebase/domain";
import type { StaffAccountView, StaffRole, StaffSessionUser } from "@/lib/types";
import { getDb, getOrCreateSessionSecret } from "./db.server";

export const SESSION_COOKIE_NAME = "rijal_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const DUMMY_SALT = "0123456789abcdef0123456789abcdef";

type StaffRow = {
  id: string;
  name: string;
  username: string;
  password_hash: string;
  password_salt: string;
  role: StaffRole;
  is_primary_admin: number;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
};

function toAccountView(row: Omit<StaffRow, "password_hash" | "password_salt" | "created_by_id">): StaffAccountView {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role === "admin" ? "admin" : "teacher",
    isPrimaryAdmin: row.is_primary_admin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, storedHashHex: string, saltHex: string): boolean {
  if (!password || !storedHashHex || !saltHex) return false;
  try {
    const derived = scryptSync(password, saltHex, 64);
    const stored = Buffer.from(storedHashHex, "hex");
    if (derived.length !== stored.length) return false;
    return timingSafeEqual(derived, stored);
  } catch {
    return false;
  }
}

export function signSessionToken(userId: string): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, iat: nowSec, exp: nowSec + SESSION_TTL_SECONDS }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", getOrCreateSessionSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const payload = parts[0] ?? "";
  const sig = parts[1] ?? "";
  if (!payload || !sig) return null;

  try {
    const expectedSig = createHmac("sha256", getOrCreateSessionSecret()).update(payload).digest("base64url");
    const sigBuf = Buffer.from(sig, "utf8");
    const expBuf = Buffer.from(expectedSig, "utf8");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown;
      exp?: unknown;
    };
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof decoded.sub !== "string" || !decoded.sub || typeof decoded.exp !== "number" || decoded.exp <= nowSec) {
      return null;
    }
    return decoded.sub;
  } catch {
    return null;
  }
}

function parseCookieHeader(cookieHeader: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key) {
      try {
        out.set(key, decodeURIComponent(val));
      } catch {
        out.set(key, val);
      }
    }
  }
  return out;
}

export function isHttpsRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto === "https") return true;
  if (forwardedProto === "http") return false;
  const origin = request.headers.get("origin");
  if (origin?.startsWith("https://")) return true;
  const referer = request.headers.get("referer");
  if (referer?.startsWith("https://")) return true;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function buildSessionCookieHeader(request: Request, token: string, maxAgeSeconds = SESSION_TTL_SECONDS): string {
  const encoded = encodeURIComponent(token);
  if (isHttpsRequest(request)) {
    return `${SESSION_COOKIE_NAME}=${encoded}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; Secure; SameSite=None; Partitioned`;
  }
  return `${SESSION_COOKIE_NAME}=${encoded}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

export function buildClearSessionCookieHeader(request: Request): string {
  if (isHttpsRequest(request)) {
    return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; Secure; SameSite=None; Partitioned`;
  }
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

function extractBearerSessionToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

export function verifySameOriginMutation(request: Request): boolean {
  if (extractBearerSessionToken(request)) {
    return true;
  }
  if (request.headers.get("x-requested-with") === "rijal-client") {
    return true;
  }
  const origin = request.headers.get("origin");
  const expectedHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim().toLowerCase() ||
    request.headers.get("host")?.trim().toLowerCase() ||
    (() => {
      try {
        return new URL(request.url).host.toLowerCase();
      } catch {
        return "";
      }
    })();

  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      return Boolean(expectedHost) && originHost === expectedHost;
    } catch {
      return false;
    }
  }

  return false;
}

export function resolveSession(request: Request): StaffSessionUser | null {
  const bearerToken = extractBearerSessionToken(request);
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const token = bearerToken ?? cookies.get(SESSION_COOKIE_NAME);
  if (!token) return null;

  const userId = verifySessionToken(token);
  if (!userId) return null;

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, username, role, is_primary_admin FROM staff_accounts WHERE id = ?`,
    )
    .get(userId) as
    | { id: string; name: string; username: string; role: StaffRole; is_primary_admin: number }
    | undefined;
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role === "admin" ? "admin" : "teacher",
    isPrimaryAdmin: row.is_primary_admin === 1,
  };
}

export function hasAnyStaffAccount(): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) AS cnt FROM staff_accounts`).get() as { cnt: number };
  return row.cnt > 0;
}

export function setupPrimaryAdmin(input: {
  name: string;
  username: string;
  password: string;
}): { ok: true; user: StaffSessionUser } | { ok: false; error: string; status: number } {
  const validated = validateStaffAccountInput({
    name: input.name,
    username: input.username,
    password: input.password,
    role: "admin",
    requirePassword: true,
  });
  if (!validated.ok) {
    return { ok: false, error: validated.error, status: 400 };
  }

  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM staff_accounts`).get() as { cnt: number };
    if (countRow.cnt > 0) {
      db.exec("ROLLBACK");
      return {
        ok: false,
        error: "تم إعداد حساب المدير الأساسي مسبقاً، سجّل الدخول باسم المستخدم وكلمة المرور",
        status: 409,
      };
    }

    const id = randomUUID();
    const nowIso = new Date().toISOString();
    const { hash, salt } = hashPassword(input.password);
    const cleanUsername = normalizeUsername(input.username);

    db.prepare(
      `INSERT INTO staff_accounts (
        id, name, username, password_hash, password_salt, role, is_primary_admin, created_by_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'admin', 1, ?, ?, ?)`,
    ).run(id, validated.name, cleanUsername, hash, salt, id, nowIso, nowIso);

    db.exec("COMMIT");
    return {
      ok: true,
      user: {
        id,
        name: validated.name,
        username: cleanUsername,
        role: "admin",
        isPrimaryAdmin: true,
      },
    };
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  }
}

export function authenticateStaffCredentials(input: {
  username: string;
  password: string;
}): StaffSessionUser | null {
  const cleanUsername = normalizeUsername(input.username);
  if (!cleanUsername || !input.password) {
    return null;
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, username, password_hash, password_salt, role, is_primary_admin
       FROM staff_accounts
       WHERE username = ?`,
    )
    .get(cleanUsername) as
    | {
        id: string;
        name: string;
        username: string;
        password_hash: string;
        password_salt: string;
        role: StaffRole;
        is_primary_admin: number;
      }
    | undefined;

  if (!row) {
    // Perform an equivalent scrypt check to equalize timing when username does not exist.
    scryptSync(input.password, DUMMY_SALT, 64);
    return null;
  }

  if (!verifyPassword(input.password, row.password_hash, row.password_salt)) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role === "admin" ? "admin" : "teacher",
    isPrimaryAdmin: row.is_primary_admin === 1,
  };
}

export function listStaffAccounts(): StaffAccountView[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, username, role, is_primary_admin, created_at, updated_at
       FROM staff_accounts
       ORDER BY is_primary_admin DESC, created_at ASC`,
    )
    .all() as Array<Omit<StaffRow, "password_hash" | "password_salt" | "created_by_id">>;
  return rows.map(toAccountView).sort((a, b) => {
    if (a.isPrimaryAdmin !== b.isPrimaryAdmin) return a.isPrimaryAdmin ? -1 : 1;
    return a.name.localeCompare(b.name, "ar");
  });
}

export function createStaffAccount(
  actorId: string,
  input: { name: string; username: string; password: string; role: StaffRole },
): { ok: true; account: StaffAccountView } | { ok: false; error: string; status: number } {
  const validated = validateStaffAccountInput({
    name: input.name,
    username: input.username,
    password: input.password,
    role: input.role,
    requirePassword: true,
  });
  if (!validated.ok) {
    return { ok: false, error: validated.error, status: 400 };
  }

  const cleanUsername = normalizeUsername(input.username);
  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM staff_accounts WHERE username = ?`)
    .get(cleanUsername) as { id: string } | undefined;
  if (existing) {
    return { ok: false, error: "اسم المستخدم هذا مسجّل مسبقاً", status: 409 };
  }

  const id = randomUUID();
  const nowIso = new Date().toISOString();
  const { hash, salt } = hashPassword(input.password);

  db.prepare(
    `INSERT INTO staff_accounts (
      id, name, username, password_hash, password_salt, role, is_primary_admin, created_by_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(id, validated.name, cleanUsername, hash, salt, validated.role, actorId, nowIso, nowIso);

  return {
    ok: true,
    account: {
      id,
      name: validated.name,
      username: cleanUsername,
      role: validated.role,
      isPrimaryAdmin: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  };
}

export function updateStaffAccount(
  actorId: string,
  accountId: string,
  patch: { name?: string; role?: StaffRole; password?: string },
): { ok: true; account: StaffAccountView } | { ok: false; error: string; status: number } {
  const db = getDb();
  const target = db
    .prepare(
      `SELECT id, name, username, role, is_primary_admin, created_at, updated_at
       FROM staff_accounts
       WHERE id = ?`,
    )
    .get(accountId) as Omit<StaffRow, "password_hash" | "password_salt" | "created_by_id"> | undefined;

  if (!target) {
    return { ok: false, error: "الحساب غير موجود", status: 404 };
  }

  const nextName = patch.name !== undefined ? patch.name : target.name;
  const nextRole: StaffRole = patch.role !== undefined ? patch.role : target.role;
  const hasNewPassword = typeof patch.password === "string" && patch.password.length > 0;

  const validated = validateStaffAccountInput({
    name: nextName,
    username: target.username,
    ...(hasNewPassword ? { password: patch.password } : {}),
    role: nextRole,
    requirePassword: hasNewPassword,
  });
  if (!validated.ok) {
    return { ok: false, error: validated.error, status: 400 };
  }

  if (hasNewPassword) {
    const pwd = patch.password ?? "";
    if (pwd.length < STAFF_LIMITS.PASSWORD_MIN || pwd.length > STAFF_LIMITS.PASSWORD_MAX) {
      return { ok: false, error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل", status: 400 };
    }
  }

  if (target.is_primary_admin === 1 && validated.role !== "admin") {
    return { ok: false, error: "لا يمكن تغيير دور المدير الأساسي", status: 403 };
  }
  if (target.id === actorId && validated.role !== "admin") {
    return { ok: false, error: "لا يمكنك إلغاء صلاحية الإدارة عن حسابك الحالي", status: 403 };
  }

  const nowIso = new Date().toISOString();
  if (hasNewPassword && patch.password) {
    const { hash, salt } = hashPassword(patch.password);
    db.prepare(
      `UPDATE staff_accounts
       SET name = ?, role = ?, password_hash = ?, password_salt = ?, updated_at = ?
       WHERE id = ?`,
    ).run(validated.name, validated.role, hash, salt, nowIso, target.id);
  } else {
    db.prepare(
      `UPDATE staff_accounts
       SET name = ?, role = ?, updated_at = ?
       WHERE id = ?`,
    ).run(validated.name, validated.role, nowIso, target.id);
  }

  db.prepare(`UPDATE attendance SET recorded_by_name = ? WHERE recorded_by_id = ?`).run(
    validated.name,
    target.id,
  );

  return {
    ok: true,
    account: {
      id: target.id,
      name: validated.name,
      username: target.username,
      role: validated.role,
      isPrimaryAdmin: target.is_primary_admin === 1,
      createdAt: target.created_at,
      updatedAt: nowIso,
    },
  };
}

export function deleteStaffAccount(
  actorId: string,
  accountId: string,
): { ok: true } | { ok: false; error: string; status: number } {
  const db = getDb();
  const target = db
    .prepare(`SELECT id, is_primary_admin FROM staff_accounts WHERE id = ?`)
    .get(accountId) as { id: string; is_primary_admin: number } | undefined;

  if (!target) {
    return { ok: false, error: "الحساب غير موجود", status: 404 };
  }
  if (target.id === actorId) {
    return { ok: false, error: "لا يمكنك حذف حسابك الحالي", status: 403 };
  }
  if (target.is_primary_admin === 1) {
    return { ok: false, error: "لا يمكن حذف حساب المدير الأساسي", status: 403 };
  }

  db.prepare(`DELETE FROM staff_accounts WHERE id = ?`).run(target.id);
  return { ok: true };
}
