import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { asc, count, desc, eq } from "drizzle-orm";
import { STAFF_LIMITS, validateStaffAccountInput } from "@/lib/firebase/domain";
import type { StaffAccountView, StaffRole, StaffSessionUser } from "@/lib/types";
import { attendance, staffAccounts } from "../../db/schema.ts";
import { getDb, getOrCreateSessionSecret } from "./db.server";

export const SESSION_COOKIE_NAME = "rijal_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const DUMMY_SALT = "0123456789abcdef0123456789abcdef";

function toAccountView(row: {
  id: string;
  name: string;
  username: string;
  role: string;
  isPrimaryAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}): StaffAccountView {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role === "admin" ? "admin" : "teacher",
    isPrimaryAdmin: row.isPrimaryAdmin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

export function signSessionTokenWithSecret(userId: string, secret: string): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, iat: nowSec, exp: nowSec + SESSION_TTL_SECONDS }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionTokenWithSecret(token: string, secret: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const payload = parts[0] ?? "";
  const sig = parts[1] ?? "";
  if (!payload || !sig) return null;

  try {
    const expectedSig = createHmac("sha256", secret).update(payload).digest("base64url");
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

export async function signSessionToken(userId: string): Promise<string> {
  const secret = await getOrCreateSessionSecret();
  return signSessionTokenWithSecret(userId, secret);
}

export async function verifySessionToken(token: string): Promise<string | null> {
  const secret = await getOrCreateSessionSecret();
  return verifySessionTokenWithSecret(token, secret);
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

export function buildSessionCookieHeader(
  request: Request,
  token: string,
  maxAgeSeconds = SESSION_TTL_SECONDS,
): string {
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

export async function resolveSession(request: Request): Promise<StaffSessionUser | null> {
  const bearerToken = extractBearerSessionToken(request);
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const token = bearerToken ?? cookies.get(SESSION_COOKIE_NAME);
  if (!token) return null;

  const userId = await verifySessionToken(token);
  if (!userId) return null;

  try {
    const db = getDb();
    const rows = await db
      .select({
        id: staffAccounts.id,
        name: staffAccounts.name,
        username: staffAccounts.username,
        role: staffAccounts.role,
        isPrimaryAdmin: staffAccounts.isPrimaryAdmin,
      })
      .from(staffAccounts)
      .where(eq(staffAccounts.id, userId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      username: row.username,
      role: row.role === "admin" ? "admin" : "teacher",
      isPrimaryAdmin: row.isPrimaryAdmin,
    };
  } catch (error) {
    console.error("Failed to resolve staff session:", error);
    throw new Error("تعذّر التحقق من الجلسة في قاعدة البيانات", { cause: error });
  }
}

export async function hasAnyStaffAccount(): Promise<boolean> {
  try {
    const db = getDb();
    const rows = await db.select({ cnt: count() }).from(staffAccounts);
    return Number(rows[0]?.cnt ?? 0) > 0;
  } catch (error) {
    console.error("Failed to check staff accounts existence:", error);
    throw new Error("تعذّر التحقق من حسابات الإدارة", { cause: error });
  }
}

export async function setupPrimaryAdmin(input: {
  name: string;
  username: string;
  password: string;
}): Promise<{ ok: true; user: StaffSessionUser } | { ok: false; error: string; status: number }> {
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

  try {
    const db = getDb();
    return await db.transaction(async (tx) => {
      const existing = await tx.select({ cnt: count() }).from(staffAccounts);
      if (Number(existing[0]?.cnt ?? 0) > 0) {
        return {
          ok: false,
          error: "تم إعداد حساب المدير الأساسي مسبقاً، سجّل الدخول باسم المستخدم وكلمة المرور",
          status: 409,
        } as const;
      }

      const id = randomUUID();
      const nowIso = new Date().toISOString();
      const { hash, salt } = hashPassword(input.password);
      const cleanUsername = normalizeUsername(input.username);

      await tx.insert(staffAccounts).values({
        id,
        name: validated.name,
        username: cleanUsername,
        passwordHash: hash,
        passwordSalt: salt,
        role: "admin",
        isPrimaryAdmin: true,
        createdById: id,
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      return {
        ok: true,
        user: {
          id,
          name: validated.name,
          username: cleanUsername,
          role: "admin",
          isPrimaryAdmin: true,
        },
      } as const;
    });
  } catch (error) {
    console.error("Primary admin setup failed:", error);
    throw new Error("تعذّر إنشاء حساب المدير الأساسي", { cause: error });
  }
}

export async function authenticateStaffCredentials(input: {
  username: string;
  password: string;
}): Promise<StaffSessionUser | null> {
  const cleanUsername = normalizeUsername(input.username);
  if (!cleanUsername || !input.password) {
    return null;
  }

  try {
    const db = getDb();
    const rows = await db
      .select({
        id: staffAccounts.id,
        name: staffAccounts.name,
        username: staffAccounts.username,
        passwordHash: staffAccounts.passwordHash,
        passwordSalt: staffAccounts.passwordSalt,
        role: staffAccounts.role,
        isPrimaryAdmin: staffAccounts.isPrimaryAdmin,
      })
      .from(staffAccounts)
      .where(eq(staffAccounts.username, cleanUsername))
      .limit(1);

    const row = rows[0];
    if (!row) {
      scryptSync(input.password, DUMMY_SALT, 64);
      return null;
    }

    if (!verifyPassword(input.password, row.passwordHash, row.passwordSalt)) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      username: row.username,
      role: row.role === "admin" ? "admin" : "teacher",
      isPrimaryAdmin: row.isPrimaryAdmin,
    };
  } catch (error) {
    console.error("Staff credential verification failed:", error);
    throw new Error("تعذّر التحقق من بيانات الدخول", { cause: error });
  }
}

export async function listStaffAccounts(): Promise<StaffAccountView[]> {
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: staffAccounts.id,
        name: staffAccounts.name,
        username: staffAccounts.username,
        role: staffAccounts.role,
        isPrimaryAdmin: staffAccounts.isPrimaryAdmin,
        createdAt: staffAccounts.createdAt,
        updatedAt: staffAccounts.updatedAt,
      })
      .from(staffAccounts)
      .orderBy(desc(staffAccounts.isPrimaryAdmin), asc(staffAccounts.createdAt));

    return rows.map(toAccountView).sort((a, b) => {
      if (a.isPrimaryAdmin !== b.isPrimaryAdmin) return a.isPrimaryAdmin ? -1 : 1;
      return a.name.localeCompare(b.name, "ar");
    });
  } catch (error) {
    console.error("Failed to list staff accounts:", error);
    throw new Error("تعذّر تحميل قائمة الحسابات", { cause: error });
  }
}

export async function createStaffAccount(
  actorId: string,
  input: { name: string; username: string; password: string; role: StaffRole },
): Promise<{ ok: true; account: StaffAccountView } | { ok: false; error: string; status: number }> {
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

  try {
    const db = getDb();
    const existing = await db
      .select({ id: staffAccounts.id })
      .from(staffAccounts)
      .where(eq(staffAccounts.username, cleanUsername))
      .limit(1);

    if (existing.length > 0) {
      return { ok: false, error: "اسم المستخدم هذا مسجّل مسبقاً", status: 409 };
    }

    const id = randomUUID();
    const nowIso = new Date().toISOString();
    const { hash, salt } = hashPassword(input.password);

    await db.insert(staffAccounts).values({
      id,
      name: validated.name,
      username: cleanUsername,
      passwordHash: hash,
      passwordSalt: salt,
      role: validated.role,
      isPrimaryAdmin: false,
      createdById: actorId,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

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
  } catch (error) {
    console.error("Failed to create staff account:", error);
    throw new Error("تعذّر إنشاء الحساب الجديد", { cause: error });
  }
}

export async function updateStaffAccount(
  actorId: string,
  accountId: string,
  patch: { name?: string; role?: StaffRole; password?: string },
): Promise<{ ok: true; account: StaffAccountView } | { ok: false; error: string; status: number }> {
  try {
    const db = getDb();
    const targetRows = await db
      .select({
        id: staffAccounts.id,
        name: staffAccounts.name,
        username: staffAccounts.username,
        role: staffAccounts.role,
        isPrimaryAdmin: staffAccounts.isPrimaryAdmin,
        createdAt: staffAccounts.createdAt,
        updatedAt: staffAccounts.updatedAt,
      })
      .from(staffAccounts)
      .where(eq(staffAccounts.id, accountId))
      .limit(1);

    const target = targetRows[0];
    if (!target) {
      return { ok: false, error: "الحساب غير موجود", status: 404 };
    }

    const targetRole: StaffRole = target.role === "admin" ? "admin" : "teacher";
    const nextName = patch.name !== undefined ? patch.name : target.name;
    const nextRole: StaffRole = patch.role !== undefined ? patch.role : targetRole;
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

    if (target.isPrimaryAdmin && validated.role !== "admin") {
      return { ok: false, error: "لا يمكن تغيير دور المدير الأساسي", status: 403 };
    }
    if (target.id === actorId && validated.role !== "admin") {
      return { ok: false, error: "لا يمكنك إلغاء صلاحية الإدارة عن حسابك الحالي", status: 403 };
    }

    const nowIso = new Date().toISOString();
    await db.transaction(async (tx) => {
      if (hasNewPassword && patch.password) {
        const { hash, salt } = hashPassword(patch.password);
        await tx
          .update(staffAccounts)
          .set({
            name: validated.name,
            role: validated.role,
            passwordHash: hash,
            passwordSalt: salt,
            updatedAt: nowIso,
          })
          .where(eq(staffAccounts.id, target.id));
      } else {
        await tx
          .update(staffAccounts)
          .set({
            name: validated.name,
            role: validated.role,
            updatedAt: nowIso,
          })
          .where(eq(staffAccounts.id, target.id));
      }

      await tx
        .update(attendance)
        .set({ recordedByName: validated.name })
        .where(eq(attendance.recordedById, target.id));
    });

    return {
      ok: true,
      account: {
        id: target.id,
        name: validated.name,
        username: target.username,
        role: validated.role,
        isPrimaryAdmin: target.isPrimaryAdmin,
        createdAt: target.createdAt,
        updatedAt: nowIso,
      },
    };
  } catch (error) {
    console.error("Failed to update staff account:", error);
    throw new Error("تعذّر تحديث بيانات الحساب", { cause: error });
  }
}

export async function deleteStaffAccount(
  actorId: string,
  accountId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  try {
    const db = getDb();
    const targetRows = await db
      .select({
        id: staffAccounts.id,
        isPrimaryAdmin: staffAccounts.isPrimaryAdmin,
      })
      .from(staffAccounts)
      .where(eq(staffAccounts.id, accountId))
      .limit(1);

    const target = targetRows[0];
    if (!target) {
      return { ok: false, error: "الحساب غير موجود", status: 404 };
    }
    if (target.id === actorId) {
      return { ok: false, error: "لا يمكنك حذف حسابك الحالي", status: 403 };
    }
    if (target.isPrimaryAdmin) {
      return { ok: false, error: "لا يمكن حذف حساب المدير الأساسي", status: 403 };
    }

    await db.delete(staffAccounts).where(eq(staffAccounts.id, target.id));
    return { ok: true };
  } catch (error) {
    console.error("Failed to delete staff account:", error);
    throw new Error("تعذّر حذف الحساب", { cause: error });
  }
}
