import { randomBytes, randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { cleanDisplayName, normalizeName } from "@/lib/arabic";
import { HISTORICAL_NOV2026_SEED } from "@/lib/seed-nov2026";
import { db, type AppDatabase } from "../../db/index.ts";
import { appSettings, attendance, students, systemConfig } from "../../db/schema.ts";

let cachedSessionSecret: string | null = null;
let seededPromise: Promise<void> | null = null;

export function getDb(): AppDatabase {
  return db;
}

export function getInMemoryFallbackSecret(): string {
  if (!cachedSessionSecret) {
    cachedSessionSecret = randomBytes(32).toString("hex");
  }
  return cachedSessionSecret;
}

export async function getOrCreateSessionSecret(): Promise<string> {
  const envSecret = process.env["SESSION_SECRET"]?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }
  if (cachedSessionSecret && cachedSessionSecret.length >= 32) {
    return cachedSessionSecret;
  }

  try {
    const existing = await db
      .select({ value: systemConfig.value })
      .from(systemConfig)
      .where(eq(systemConfig.key, "session_secret"))
      .limit(1);

    const stored = existing[0]?.value;
    if (stored && stored.length >= 32) {
      cachedSessionSecret = stored;
      return stored;
    }

    const generated = randomBytes(32).toString("hex");
    await db
      .insert(systemConfig)
      .values({ key: "session_secret", value: generated })
      .onConflictDoNothing({ target: systemConfig.key });

    const confirmed = await db
      .select({ value: systemConfig.value })
      .from(systemConfig)
      .where(eq(systemConfig.key, "session_secret"))
      .limit(1);

    const finalSecret = confirmed[0]?.value || generated;
    cachedSessionSecret = finalSecret;
    return finalSecret;
  } catch (error) {
    console.error("Failed to load session secret from PostgreSQL:", error);
    throw new Error("تعذّر التحقق من إعدادات الجلسة في قاعدة البيانات", { cause: error });
  }
}

export async function ensureInitialDataSeeded(): Promise<void> {
  if (seededPromise) {
    return seededPromise;
  }

  seededPromise = (async () => {
    try {
      const nowIso = new Date().toISOString();
      await db
        .insert(appSettings)
        .values([
          {
            key: "results_public",
            value: "false",
            updatedAt: nowIso,
            updatedById: null,
          },
          {
            key: "teacher_entry_enabled",
            value: "true",
            updatedAt: nowIso,
            updatedById: null,
          },
        ])
        .onConflictDoNothing({ target: appSettings.key });

      const seededRow = await db
        .select({ value: systemConfig.value })
        .from(systemConfig)
        .where(eq(systemConfig.key, "nov2026_seeded"))
        .limit(1);

      if (seededRow[0]?.value === "1") {
        return;
      }

      const studentCountRows = await db.select({ cnt: count() }).from(students);
      const existingCount = Number(studentCountRows[0]?.cnt ?? 0);
      if (existingCount > 0) {
        await db
          .insert(systemConfig)
          .values({ key: "nov2026_seeded", value: "1" })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: { value: "1" },
          });
        return;
      }

      await db.transaction(async (tx) => {
        const flagInTx = await tx
          .select({ value: systemConfig.value })
          .from(systemConfig)
          .where(eq(systemConfig.key, "nov2026_seeded"))
          .limit(1);
        if (flagInTx[0]?.value === "1") return;

        const studentValues: Array<typeof students.$inferInsert> = [];
        const attendanceValues: Array<typeof attendance.$inferInsert> = [];
        const seenNorms = new Set<string>();

        for (const item of HISTORICAL_NOV2026_SEED) {
          const fullName = cleanDisplayName(item.fullName);
          const normalized = normalizeName(fullName);
          if (!fullName || !normalized || seenNorms.has(normalized)) continue;
          seenNorms.add(normalized);

          const studentId = randomUUID();
          studentValues.push({
            id: studentId,
            fullName,
            normalizedName: normalized,
            createdById: "system_seed",
            createdAt: nowIso,
            updatedAt: nowIso,
          });

          for (const attendedOn of item.dates) {
            attendanceValues.push({
              id: `${attendedOn}_${studentId}`,
              studentId,
              studentName: fullName,
              attendedOn,
              recordedById: "system_seed",
              recordedByName: "سجل الإدارة",
              recordedByUsername: "system",
              createdAt: `${attendedOn}T04:30:00.000Z`,
            });
          }
        }

        if (studentValues.length > 0) {
          await tx.insert(students).values(studentValues).onConflictDoNothing({
            target: students.normalizedName,
          });
        }

        if (attendanceValues.length > 0) {
          for (let i = 0; i < attendanceValues.length; i += 200) {
            const chunk = attendanceValues.slice(i, i + 200);
            await tx.insert(attendance).values(chunk).onConflictDoNothing();
          }
        }

        await tx
          .insert(systemConfig)
          .values({ key: "nov2026_seeded", value: "1" })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: { value: "1" },
          });
      });
    } catch (error) {
      seededPromise = null;
      console.error("Database initial seed check failed:", error);
      throw new Error("تعذّر الاتصال بقاعدة البيانات الدائمة", { cause: error });
    }
  })();

  return seededPromise;
}

export function resetSeedCacheForTesting(): void {
  seededPromise = null;
}
