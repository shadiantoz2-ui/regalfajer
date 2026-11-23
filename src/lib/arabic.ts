/** Arabic name helpers: normalization, fuzzy matching, and local dates with English digits. */

const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const ARABIC_DIGITS = /[\u0660-\u0669]/g;

export function toEnglishDigits(input: string): string {
  return input.replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Collapse spelling variants so "عبدالله" and "عبد اللّه" compare equal. */
export function normalizeName(input: string): string {
  let s = toEnglishDigits(input).replace(TASHKEEL, "");
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

/** Tidy the display form: trim and collapse spaces, keep the original letters. */
export function cleanDisplayName(input: string): string {
  return toEnglishDigits(input)
    .replace(/[.,،؛!?؟"'«»]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
