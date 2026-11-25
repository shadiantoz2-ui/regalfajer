import { describe, expect, it } from "vitest";
import {
  collapseRepeatedPhrases,
  composeArabicHamzas,
  findNameMatches,
  formatDateLong,
  localDateKey,
  mergeSpeechSegments,
  nameSimilarity,
  needsHamzaOrMaddaReview,
  normalizeName,
  restoreArabicHamzaAndMadda,
  sameFirstAndFamily,
  toEnglishDigits,
} from "./arabic";
import { trimAndNormalizeSpeech } from "./record-wav";

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

  it("matches name + family name when the father's name is left out", () => {
    const students = [{ id: "1", full_name: "محمد أحمد العتيبي" }];
    expect(findNameMatches("محمد العتيبي", students)[0]?.item.id).toBe("1");
  });

  it("matches a stored name + family name when the student also says the father's name", () => {
    const students = [{ id: "1", full_name: "خالد القحطاني" }];
    expect(findNameMatches("خالد سعد القحطاني", students)[0]?.item.id).toBe("1");
  });

  it("flags same first and family name as a likely duplicate", () => {
    expect(sameFirstAndFamily("محمد العتيبي", "محمد أحمد العتيبي")).toBe(true);
    expect(sameFirstAndFamily("محمد العتيبي", "محمد الشمري")).toBe(false);
  });

  it("scores identical names as 1", () => {
    expect(nameSimilarity("سعد فهد الشمري", "سعد فهد الشمري")).toBe(1);
  });

  it("collapses repeated words and phrases from speech engines", () => {
    expect(collapseRepeatedPhrases("علي حسن علي حسن")).toBe("علي حسن");
    expect(collapseRepeatedPhrases("محمد محمد أحمد")).toBe("محمد أحمد");
    expect(collapseRepeatedPhrases("خالد يوسف الحسن خالد يوسف الحسن")).toBe("خالد يوسف الحسن");
  });

  it("merges cumulative Android SpeechRecognition segments without repeating", () => {
    expect(mergeSpeechSegments(["خالد", "خالد يوسف", "خالد يوسف الحسن"])).toBe("خالد يوسف الحسن");
    expect(mergeSpeechSegments(["سالم محمد", "محمد العتيبي"])).toBe("سالم محمد العتيبي");
  });

  it("composes decomposed Unicode hamza/madda combining marks cleanly", () => {
    expect(composeArabicHamzas("ا\u0654حمد ا\u0655براهيم ا\u0653دم فو\u0654اد")).toBe("أحمد إبراهيم آدم فؤاد");
  });

  it("restores Arabic hamzas, maddas, clan prefix 'آل', and compound prefixes", () => {
    expect(restoreArabicHamzaAndMadda("احمد ابراهيم ادم")).toBe("أحمد إبراهيم آدم");
    expect(restoreArabicHamzaAndMadda("فواد مويد الابراهيم")).toBe("فؤاد مؤيد الإبراهيم");
    expect(restoreArabicHamzaAndMadda("اسماء الاء الاحمد")).toBe("أسماء آلاء الأحمد");
    expect(restoreArabicHamzaAndMadda("محمد ال علي")).toBe("محمد آل علي");
    expect(restoreArabicHamzaAndMadda("عبدالاحد عبدالاله")).toBe("عبدالأحد عبدالإله");
    expect(restoreArabicHamzaAndMadda("وايل رايد فايز ارناؤوط")).toBe("وائل رائد فائز أرناؤوط");
  });

  it("keeps hamzat wasl words clean while flagging rare bare-alif names for AI review", () => {
    expect(needsHamzaOrMaddaReview("محمد ابن علي")).toBe(false);
    expect(needsHamzaOrMaddaReview("أحمد إبراهيم آدم")).toBe(false);
    expect(needsHamzaOrMaddaReview("ارسلان محمد")).toBe(true);
  });

  it("trims silence and gently normalizes quiet speech PCM", () => {
    const samples = new Float32Array(16000);
    for (let i = 4000; i < 8000; i++) samples[i] = 0.1;
    const { pcm, peak } = trimAndNormalizeSpeech(samples, 16000);
    expect(peak).toBeCloseTo(0.1, 3);
    expect(pcm.length).toBeLessThan(samples.length);
    expect(Math.max(...Array.from(pcm))).toBeGreaterThan(0.3);
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
