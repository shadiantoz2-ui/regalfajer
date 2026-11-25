export type HistoricalStudentSeed = {
  fullName: string;
  expectedDays: number;
  dates: readonly string[];
};

const D21 = "2026-11-21";
const D22 = "2026-11-22";
const D23 = "2026-11-23";
const D24 = "2026-11-24";
const D25 = "2026-11-25";

function buildDates(d21: 0 | 1, d22: 0 | 1, d23: 0 | 1, d24: 0 | 1, d25: 0 | 1): string[] {
  const out: string[] = [];
  if (d21) out.push(D21);
  if (d22) out.push(D22);
  if (d23) out.push(D23);
  if (d24) out.push(D24);
  if (d25) out.push(D25);
  return out;
}

/**
 * Verified 72-student roster and attendance grid (2026-11-21 .. 2026-11-25).
 * Names follow "first name (including compound first names like محمد أمين) + family name".
 */
export const HISTORICAL_NOV2026_SEED: readonly HistoricalStudentSeed[] = [
  { fullName: "أسامة العلاوي", expectedDays: 1, dates: buildDates(0, 0, 0, 0, 1) },
  { fullName: "أسامة جبري", expectedDays: 1, dates: buildDates(0, 0, 0, 0, 1) },
  { fullName: "أمير الخطيب", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "أمير جاويش", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "أنس شقير", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "أنس مطيط", expectedDays: 3, dates: buildDates(0, 0, 1, 1, 1) },
  { fullName: "أويس جنيد", expectedDays: 5, dates: buildDates(1, 1, 1, 1, 1) },
  { fullName: "إسكندر أبو آذان", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "براء جبري", expectedDays: 3, dates: buildDates(0, 0, 1, 1, 1) },
  { fullName: "براء عارفة", expectedDays: 3, dates: buildDates(0, 1, 0, 1, 1) },
  { fullName: "بسام أبو آذان", expectedDays: 3, dates: buildDates(0, 0, 1, 1, 1) },
  { fullName: "بكر طه", expectedDays: 1, dates: buildDates(0, 0, 0, 0, 1) },
  { fullName: "بلال الزالق", expectedDays: 2, dates: buildDates(0, 0, 0, 1, 1) },
  { fullName: "بلال طه", expectedDays: 1, dates: buildDates(0, 0, 0, 0, 1) },
  { fullName: "بيازيد السيد", expectedDays: 4, dates: buildDates(1, 1, 1, 0, 1) },
  { fullName: "جهاد البكا", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "حمزة الغربي", expectedDays: 5, dates: buildDates(1, 1, 1, 1, 1) },
  { fullName: "حمزة المهدي", expectedDays: 3, dates: buildDates(0, 1, 0, 1, 1) },
  { fullName: "ربيع زهوري", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "رضا شداد", expectedDays: 2, dates: buildDates(0, 0, 1, 1, 0) },
  { fullName: "رضوان الصغير", expectedDays: 3, dates: buildDates(0, 0, 1, 1, 1) },
  { fullName: "زاهر البعلي", expectedDays: 3, dates: buildDates(0, 0, 1, 1, 1) },
  { fullName: "زين العابدين القاضي", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "سراج مشيلم", expectedDays: 2, dates: buildDates(0, 0, 1, 1, 0) },
  { fullName: "صلاح الدين الأطرش", expectedDays: 5, dates: buildDates(1, 1, 1, 1, 1) },
  { fullName: "طه رحمة", expectedDays: 1, dates: buildDates(0, 0, 0, 0, 1) },
  { fullName: "عادل درويش", expectedDays: 4, dates: buildDates(1, 1, 0, 1, 1) },
  { fullName: "عبد الكريم عبد الواحد", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "عبد الله علاوي", expectedDays: 5, dates: buildDates(1, 1, 1, 1, 1) },
  { fullName: "عبيدة جمعة", expectedDays: 3, dates: buildDates(0, 0, 1, 1, 1) },
  { fullName: "عدي علاوي", expectedDays: 1, dates: buildDates(0, 0, 1, 0, 0) },
  { fullName: "عروة القاضي", expectedDays: 3, dates: buildDates(0, 0, 1, 1, 1) },
  { fullName: "عصام الأطرش", expectedDays: 5, dates: buildDates(1, 1, 1, 1, 1) },
  { fullName: "عطا بغدادي", expectedDays: 1, dates: buildDates(0, 0, 0, 0, 1) },
  { fullName: "عمر الزهوري", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "عمر الهبول", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "عمر زينو", expectedDays: 3, dates: buildDates(0, 0, 1, 1, 1) },
  { fullName: "عمر عبد الواحد", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "غياث مطيط", expectedDays: 2, dates: buildDates(0, 0, 0, 1, 1) },
  { fullName: "غيث المهدي", expectedDays: 3, dates: buildDates(0, 1, 0, 1, 1) },
  { fullName: "فارس جاويش", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "فراس مشيلم", expectedDays: 3, dates: buildDates(0, 1, 1, 1, 0) },
  { fullName: "فهد أبو آذان", expectedDays: 2, dates: buildDates(0, 0, 0, 1, 1) },
  { fullName: "قصي دياب", expectedDays: 2, dates: buildDates(0, 0, 1, 0, 1) },
  { fullName: "كرم القاضي", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "محمد أمين الزهوري", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "محمد البقاعي", expectedDays: 3, dates: buildDates(0, 1, 1, 0, 1) },
  { fullName: "محمد الصغير", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "محمد النابلسي", expectedDays: 1, dates: buildDates(0, 0, 0, 0, 1) },
  { fullName: "محمد حمزة الأطرش", expectedDays: 5, dates: buildDates(1, 1, 1, 1, 1) },
  { fullName: "محمد سكرية", expectedDays: 2, dates: buildDates(0, 0, 0, 1, 1) },
  { fullName: "محمد شقير", expectedDays: 2, dates: buildDates(0, 0, 0, 1, 1) },
  { fullName: "محمد عبد الكريم عباس", expectedDays: 5, dates: buildDates(1, 1, 1, 1, 1) },
  { fullName: "محمد علي أبو آذان", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "محمد عمار الصغير", expectedDays: 2, dates: buildDates(1, 1, 0, 0, 0) },
  { fullName: "محمد منصور شكور", expectedDays: 2, dates: buildDates(0, 0, 0, 1, 1) },
  { fullName: "محمد نذير خرقي", expectedDays: 1, dates: buildDates(0, 0, 0, 1, 0) },
  { fullName: "محمد نور سكر", expectedDays: 5, dates: buildDates(1, 1, 1, 1, 1) },
  { fullName: "محمود جمعة", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "مصعب درويش", expectedDays: 2, dates: buildDates(0, 0, 0, 1, 1) },
  { fullName: "معاذ كريم", expectedDays: 1, dates: buildDates(0, 0, 0, 0, 1) },
  { fullName: "مهند الزهوري", expectedDays: 4, dates: buildDates(0, 1, 1, 1, 1) },
  { fullName: "نجم القاضي", expectedDays: 5, dates: buildDates(1, 1, 1, 1, 1) },
  { fullName: "نضال قزعور", expectedDays: 2, dates: buildDates(0, 0, 1, 1, 0) },
  { fullName: "هناك مطولة", expectedDays: 1, dates: buildDates(0, 0, 0, 0, 1) },
  { fullName: "ورد الإسلام شقير", expectedDays: 2, dates: buildDates(0, 0, 0, 1, 1) },
  { fullName: "ياسر الصغير", expectedDays: 3, dates: buildDates(0, 0, 1, 1, 1) },
  { fullName: "ياسر طعمة", expectedDays: 2, dates: buildDates(1, 1, 0, 0, 0) },
  { fullName: "ياقوت الهبول", expectedDays: 1, dates: buildDates(0, 0, 0, 0, 1) },
  { fullName: "يحيى جمعة", expectedDays: 3, dates: buildDates(0, 0, 1, 1, 1) },
  { fullName: "يزن طعمة", expectedDays: 1, dates: buildDates(0, 1, 0, 0, 0) },
  { fullName: "يوسف سكر", expectedDays: 5, dates: buildDates(1, 1, 1, 1, 1) },
];
