import { describe, expect, it } from "vitest";
import { normalizeName } from "./arabic";
import { validateStudentDisplayName } from "./firebase/domain";
import { HISTORICAL_NOV2026_SEED } from "./seed-nov2026";

describe("Historical Nov 2026 seed dataset", () => {
  it("contains all 72 unique valid student names", () => {
    expect(HISTORICAL_NOV2026_SEED).toHaveLength(72);
    const seen = new Set<string>();
    for (const row of HISTORICAL_NOV2026_SEED) {
      const check = validateStudentDisplayName(row.fullName);
      expect(check.valid).toBe(true);
      expect(seen.has(check.normalized_name)).toBe(false);
      seen.add(check.normalized_name);
    }
  });

  it("matches each student's exact PDF attendance day count checksum", () => {
    for (const row of HISTORICAL_NOV2026_SEED) {
      expect(row.dates).toHaveLength(row.expectedDays);
      for (const d of row.dates) {
        expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("keeps compound first names distinct under normalization", () => {
    expect(normalizeName("محمد الصغير")).not.toBe(normalizeName("محمد عمار الصغير"));
    expect(normalizeName("محمد شقير")).not.toBe(normalizeName("ورد الإسلام شقير"));
  });
});
