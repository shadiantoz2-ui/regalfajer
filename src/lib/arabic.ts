/** Arabic name helpers: normalization, hamza/madda restoration, fuzzy matching, and local dates with English digits. */

const COMBINING_MADDA = /\u0627\u0653/g;
const COMBINING_HAMZA_ABOVE_ALIF = /\u0627\u0654/g;
const COMBINING_HAMZA_BELOW_ALIF = /\u0627\u0655/g;
const COMBINING_HAMZA_WAW = /\u0648\u0654/g;
const COMBINING_HAMZA_YA = /[\u064A\u0649]\u0654/g;

const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const ARABIC_DIGITS = /[\u0660-\u0669]/g;

export function toEnglishDigits(input: string): string {
  return input.replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Compose decomposed Unicode hamza/madda sequences (e.g. ا + ٔ -> أ) before stripping harakat. */
export function composeArabicHamzas(input: string): string {
  return input
    .normalize("NFC")
    .replace(COMBINING_MADDA, "آ")
    .replace(COMBINING_HAMZA_ABOVE_ALIF, "أ")
    .replace(COMBINING_HAMZA_BELOW_ALIF, "إ")
    .replace(COMBINING_HAMZA_WAW, "ؤ")
    .replace(COMBINING_HAMZA_YA, "ئ");
}

/** Collapse spelling variants so "عبدالله" and "عبد اللّه" compare equal. */
export function normalizeName(input: string): string {
  let s = toEnglishDigits(composeArabicHamzas(input)).replace(TASHKEEL, "");
  s = s
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\u0621-\u064Aa-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  // join compound names: "عبد الله" -> "عبدالله", "ابو بكر" -> "ابوبكر"
  s = s.replace(/(^|\s)(عبد|ابو)\s+/g, "$1$2");
  // drop lineage words: "محمد بن احمد" -> "محمد احمد"
  s = s
    .split(" ")
    .filter((w) => w !== "بن" && w !== "ابن")
    .join(" ");
  return s;
}

/** Tidy the display form: compose hamzas/maddas, strip stray harakat/punctuation, keep Arabic letters intact. */
export function cleanDisplayName(input: string): string {
  return toEnglishDigits(composeArabicHamzas(input))
    .replace(TASHKEEL, "")
    .replace(/[.,،؛:!?؟"'«»()[\]{}\-_/\\|*~`^@#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const HAMZA_MADDA_MAP: Record<string, string> = {
  // Madda (آ)
  ادم: "آدم",
  ادمي: "آدمي",
  الاء: "آلاء",
  امنة: "آمنة",
  امنه: "آمنة",
  امال: "آمال",
  اغا: "آغا",
  اية: "آية",
  ايات: "آيات",
  اسيا: "آسيا",
  اسر: "آسر",
  اصف: "آصف",
  ازر: "آزر",
  ارام: "آرام",
  اخر: "آخر",
  الوسي: "آلوسي",
  مارب: "مآرب",
  ماثر: "مآثر",

  // Hamza above Alif (أ)
  احمد: "أحمد",
  احمدي: "أحمدي",
  احمدو: "أحمدو",
  احد: "أحد",
  احسن: "أحسن",
  اعلى: "أعلى",
  اول: "أول",
  اسامة: "أسامة",
  اسامه: "أسامة",
  اسماء: "أسماء",
  اسعد: "أسعد",
  اسيد: "أسيد",
  اسد: "أسد",
  اسمر: "أسمر",
  اسلم: "أسلم",
  اسيل: "أسيل",
  اشرف: "أشرف",
  اشقر: "أشقر",
  اكرم: "أكرم",
  اكثم: "أكثم",
  اكمل: "أكمل",
  امجد: "أمجد",
  امين: "أمين",
  امير: "أمير",
  اميرة: "أميرة",
  اميره: "أميرة",
  اميري: "أميري",
  اموي: "أموي",
  امية: "أمية",
  اميمه: "أميمة",
  اميمة: "أميمة",
  امل: "أمل",
  اماني: "أماني",
  انس: "أنس",
  انور: "أنور",
  انيس: "أنيس",
  انصاري: "أنصاري",
  انمار: "أنمار",
  ايمن: "أيمن",
  ايوب: "أيوب",
  ايوبي: "أيوبي",
  ايهم: "أيهم",
  ايسر: "أيسر",
  اوس: "أوس",
  اويس: "أويس",
  اواب: "أواب",
  اصيل: "أصيل",
  اثير: "أثير",
  ادهم: "أدهم",
  اديب: "أديب",
  اريج: "أريج",
  ارقم: "أرقم",
  اركان: "أركان",
  ارسلان: "أرسلان",
  اصلان: "أصلان",
  ازهر: "أزهر",
  افضل: "أفضل",
  ارشد: "أرشد",
  اغيد: "أغيد",
  اروى: "أروى",
  احلام: "أحلام",
  افنان: "أفنان",
  ابو: "أبو",
  ابوبكر: "أبوبكر",
  ابوزيد: "أبوزيد",
  ارناووط: "أرناؤوط",
  ارناؤوط: "أرناؤوط",
  اتاسي: "أتاسي",
  ابناء: "أبناء",

  // Hamza below Alif (إ)
  ابراهيم: "إبراهيم",
  ابراهيمي: "إبراهيمي",
  اسماعيل: "إسماعيل",
  اسحاق: "إسحاق",
  اسحق: "إسحق",
  اسلام: "إسلام",
  اسراء: "إسراء",
  اسعاد: "إسعاد",
  اسعاف: "إسعاف",
  ادريس: "إدريس",
  ادريسي: "إدريسي",
  الياس: "إلياس",
  اياد: "إياد",
  ايهاب: "إيهاب",
  اياس: "إياس",
  ايلاف: "إيلاف",
  ايمان: "إيمان",
  ايثار: "إيثار",
  ايناس: "إيناس",
  احسان: "إحسان",
  اكرام: "إكرام",
  اقبال: "إقبال",
  ارشاد: "إرشاد",
  الهام: "إلهام",
  انعام: "إنعام",
  اخلاص: "إخلاص",
  اسكندر: "إسكندر",
  امام: "إمام",
  اله: "إله",

  // Medial / on-waw / on-ya / on-alif hamza (ؤ، ئ، أ)
  فواد: "فؤاد",
  مويد: "مؤيد",
  مومن: "مؤمن",
  مونس: "مؤنس",
  موتمن: "مؤتمن",
  مومل: "مؤمل",
  لوي: "لؤي",
  رووف: "رؤوف",
  روى: "رؤى",
  رويا: "رؤيا",
  سودد: "سؤدد",
  مامون: "مأمون",
  رافت: "رأفت",
  رايد: "رائد",
  وايل: "وائل",
  سايد: "سائد",
  نايل: "نائل",
  فايز: "فائز",
  عايد: "عائد",
  ثاير: "ثائر",
  زاير: "زائر",
  ويام: "وئام",
};

const HAMZAT_WASL_WORDS = new Set(["ابن", "ابنة", "ابنه", "اسم", "امرؤ", "امراة", "اثنان", "اثنين", "اثنتان", "اثنتين"]);

/**
 * Restore standard Arabic hamzas (أ، إ، أُ/ؤ، ئ، ء) and madda (آ) on voice-transcribed names,
 * including standalone clan prefix "آل" (e.g. "محمد ال علي" -> "محمد آل علي")
 * and "الـ..." family-name prefixes (e.g. "الاحمد" -> "الأحمد").
 */
export function restoreArabicHamzaAndMadda(input: string): string {
  const cleaned = cleanDisplayName(input);
  if (!cleaned) return "";

  const words = cleaned.split(" ");
  return words
    .map((word, index) => {
      // Standalone "ال" in a multi-word name denotes the clan/family title "آل"
      if (word === "ال" && words.length > 1 && index < words.length - 1) {
        return "آل";
      }

      const direct = HAMZA_MADDA_MAP[word];
      if (direct) return direct;

      if (/[أإآؤئ]/.test(word)) return word;

      if (word.startsWith("ال") && word.length > 3) {
        const stem = word.slice(2);
        const mappedStem = HAMZA_MADDA_MAP[stem];
        if (mappedStem) return `ال${mappedStem}`;
      }

      if (word.startsWith("عبدال") && word.length > 6) {
        const stem = word.slice(5);
        const mappedStem = HAMZA_MADDA_MAP[stem];
        if (mappedStem) return `عبدال${mappedStem}`;
      }

      return word;
    })
    .join(" ");
}

/**
 * True if a transcribed Arabic name still contains words with bare initial alif or common
 * medial glides that are not resolved by the built-in hamza/madda dictionary.
 */
export function needsHamzaOrMaddaReview(input: string): boolean {
  const cleaned = cleanDisplayName(input);
  if (!cleaned) return false;

  for (const word of cleaned.split(" ")) {
    if (!word || HAMZAT_WASL_WORDS.has(word)) continue;
    if (word === "ال") return true;
    if (word.startsWith("ا") && !word.startsWith("ال") && !/[أإآ]/.test(word)) {
      return true;
    }
    if (/^[أإآ]?.+(?:وا|يا).+$/.test(word) && !/[ؤئ]/.test(word)) {
      return true;
    }
  }
  return false;
}

/**
 * Remove consecutive repeated words or 1..5-word phrases caused by echoing speech engines
 * (e.g. "علي حسن علي حسن" -> "علي حسن", "محمد محمد أحمد" -> "محمد أحمد").
 */
export function collapseRepeatedPhrases(input: string): string {
  const cleaned = cleanDisplayName(input);
  if (!cleaned) return "";
  let words = cleaned.split(" ");

  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    const maxSpan = Math.min(5, Math.floor(words.length / 2));
    for (let span = maxSpan; span >= 1; span--) {
      const next: string[] = [];
      let i = 0;
      while (i < words.length) {
        if (i + 2 * span <= words.length) {
          const left = normalizeName(words.slice(i, i + span).join(" "));
          const right = normalizeName(words.slice(i + span, i + 2 * span).join(" "));
          if (left && left === right) {
            next.push(...words.slice(i, i + span));
            i += 2 * span;
            while (
              i + span <= words.length &&
              normalizeName(words.slice(i, i + span).join(" ")) === left
            ) {
              i += span;
            }
            changed = true;
            continue;
          }
        }
        next.push(words[i] ?? "");
        i += 1;
      }
      words = next.filter(Boolean);
    }
    if (!changed) break;
  }

  return words.join(" ").trim();
}

/**
 * Merge sequential SpeechRecognition transcript segments without repeating cumulative
 * or overlapping prefixes (common on Android Chrome with continuous=true).
 */
export function mergeSpeechSegments(segments: readonly string[]): string {
  const merged: string[] = [];

  for (const raw of segments) {
    const clean = collapseRepeatedPhrases(raw);
    if (!clean) continue;
    const norm = normalizeName(clean);
    if (!norm) continue;

    if (merged.length === 0) {
      merged.push(clean);
      continue;
    }

    const last = merged[merged.length - 1] ?? "";
    const lastNorm = normalizeName(last);
    const fullNorm = normalizeName(merged.join(" "));

    if (norm === lastNorm || norm === fullNorm) continue;
    if (norm.startsWith(`${fullNorm} `)) {
      merged.splice(0, merged.length, clean);
      continue;
    }
    if (norm.startsWith(`${lastNorm} `)) {
      merged[merged.length - 1] = clean;
      continue;
    }
    if (
      lastNorm.startsWith(`${norm} `) ||
      lastNorm.endsWith(` ${norm}`) ||
      fullNorm.endsWith(` ${norm}`)
    ) {
      continue;
    }

    const lastWords = last.split(" ");
    const curWords = clean.split(" ");
    const maxOverlap = Math.min(lastWords.length, curWords.length, 5);
    let overlap = 0;
    for (let k = maxOverlap; k >= 1; k--) {
      const tail = normalizeName(lastWords.slice(-k).join(" "));
      const head = normalizeName(curWords.slice(0, k).join(" "));
      if (tail && tail === head) {
        overlap = k;
        break;
      }
    }

    const remainder = curWords.slice(overlap).join(" ").trim();
    if (remainder) merged.push(remainder);
  }

  return collapseRepeatedPhrases(merged.join(" "));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

function ratio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

function firstLast(tokens: string[]): string {
  return tokens.length >= 2 ? `${tokens[0]} ${tokens[tokens.length - 1]}` : tokens.join(" ");
}

/**
 * 0..1 score between what was heard and a stored name.
 * Names are "first name + family name", with the father's name optional in the middle,
 * so "محمد العتيبي" and "محمد أحمد العتيبي" should still match.
 */
export function nameSimilarity(heard: string, stored: string): number {
  const h = normalizeName(heard);
  const s = normalizeName(stored);
  if (!h || !s) return 0;
  if (h === s) return 1;
  const full = ratio(h, s);
  const hTokens = h.split(" ");
  const sTokens = s.split(" ");
  let partial = 0;
  if (hTokens.length !== sTokens.length && hTokens.length >= 2 && sTokens.length >= 2) {
    partial = ratio(firstLast(hTokens), firstLast(sTokens)) * 0.95;
  }
  return Math.max(full, partial);
}

/** True when two names likely belong to the same person (same first + family name). */
export function sameFirstAndFamily(a: string, b: string): boolean {
  const x = normalizeName(a).split(" ");
  const y = normalizeName(b).split(" ");
  if (x.length < 2 || y.length < 2) return false;
  return firstLast(x) === firstLast(y);
}

export type NameMatch<T> = { item: T; score: number };

export const MATCH_THRESHOLD = 0.62;

export function findNameMatches<T extends { full_name: string }>(
  heard: string,
  items: readonly T[],
  limit = 4,
): NameMatch<T>[] {
  return items
    .map((item) => ({ item, score: nameSimilarity(heard, item.full_name) }))
    .filter((m) => m.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** YYYY-MM-DD in the device's local time zone. */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

const longFmt = new Intl.DateTimeFormat("ar-u-nu-latn", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const shortFmt = new Intl.DateTimeFormat("ar-u-nu-latn", { weekday: "short", day: "numeric", month: "short" });

export function formatDateLong(key: string): string {
  return toEnglishDigits(longFmt.format(parseDateKey(key)));
}

export function formatDateShort(key: string): string {
  return toEnglishDigits(shortFmt.format(parseDateKey(key)));
}
