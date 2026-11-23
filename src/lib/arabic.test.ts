import { describe, expect, it } from "vitest";
import { findNameMatches, localDateKey, nameSimilarity, normalizeName, toEnglishDigits, formatDateLong } from "./arabic";

describe("Arabic name matching", () => {
  it("treats hamza, taa marbuta and tashkeel variants as the same name", () => {
    expect(normalizeName("أُسَامَة إبراهيم")).toBe(normalizeName("اسامه ابراهيم"));
  });

  it("treats 'عبد الله' and 'عبدالله' as the same name", () => {
    expect(normalizeName("عبد الله محمد علي")).toBe(normalizeName("عبدالله محمد علي"));
  });

  it("matches a spoken three-part name to the stored student", () => {
    const students = [
      { id: "1", full_name: "محمد أحمد العتيبي" },
      { id: "2", full_name: "خالد سعد القحطاني" },
    ];
    const [best] = findNameMatches("محمد احمد العتيبي", students);
    expect(best?.item.id).toBe("1");
  });

  it("does not match an unrelated name", () => {
    const students = [{ id: "1", full_name: "خالد سعد القحطاني" }];
    expect(findNameMatches("يوسف ناصر الدوسري", students)).toHaveLength(0);
  });

  it("scores identical names as 1", () => {
    expect(nameSimilarity("سعد فهد الشمري", "سعد فهد الشمري")).toBe(1);
  });
});

describe("numbers and dates use English digits", () => {
  it("converts Arabic-Indic digits", () => {
    expect(toEnglishDigits("٢٠٢٦")).toBe("2026");
  });

  it("formats dates without Arabic-Indic digits", () => {
    expect(formatDateLong("2026-11-23")).toMatch(/23/);
    expect(formatDateLong("2026-11-23")).not.toMatch(/[\u0660-\u0669]/);
  });

  it("builds a local YYYY-MM-DD key", () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
