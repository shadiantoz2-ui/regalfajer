import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Lock, Trophy } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { publicResultsQuery } from "@/lib/data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "رجال الفجر — نتائج الحضور" },
      { name: "description", content: "عدد أيام حضور كل طالب في رجال الفجر." },
      { property: "og:title", content: "رجال الفجر — نتائج الحضور" },
      { property: "og:description", content: "عدد أيام حضور كل طالب في رجال الفجر." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PublicResults,
});

function PublicResults() {
  const { data, isLoading } = useQuery(publicResultsQuery());

  return (
    <AppShell>
      {isLoading || !data ? (
        <div className="h-40 animate-pulse rounded-[2rem] surface" />
      ) : !data.open ? (
        <section className="overflow-hidden rounded-[2rem] border border-primary/25 bg-[#0b1222] text-center shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]">
          <div className="relative aspect-[1255/315] w-full overflow-hidden">
            <img
              src="/assets/aistudio/Screenshot_2026-11-24_223058_900ac543.png"
              alt="مسجد الغفران عند الفجر"
              className="block h-auto w-full select-none"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-[#0b1222]/35 to-[#0b1222]"
            />
          </div>
          <div className="relative -mt-8 flex flex-col items-center px-6 pb-10 sm:-mt-9">
            <div className="grid size-16 place-items-center rounded-2xl border border-primary/35 bg-[#0e1629]/95 shadow-[0_12px_32px_rgba(0,0,0,0.6)]">
              <Lock className="size-7 text-primary" strokeWidth={1.9} />
            </div>
            <h2 className="font-display mt-5 text-3xl font-bold text-foreground sm:text-4xl">
              النتائج غير متاحة حالياً
            </h2>
            <p className="mt-3 max-w-lg text-base leading-relaxed text-muted-foreground">
              مسجد الغفران • تم إغلاق لوحة الشرف مؤقتاً من قِبل الإدارة وسيتم إتاحتها للجمهور والطلاب فور اعتماد النتائج.
            </p>
          </div>
        </section>
      ) : (
        <section className="rounded-[2rem] p-6 surface">
          <h2 className="font-display flex items-center gap-2 text-2xl">
            <Trophy className="size-6 text-primary" /> نتائج الحضور
          </h2>
          {data.rows.length === 0 ? (
            <p className="mt-6 text-center text-muted-foreground">لا يوجد طلاب بعد</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {data.rows.map((r, i) => (
                <li key={`${r.full_name}-${i}`} className="flex items-center gap-3 py-3">
                  <span className="w-8 text-center text-sm text-muted-foreground">{i + 1}</span>
                  <span className="flex-1">{r.full_name}</span>
                  <span className="rounded-full bg-primary/15 px-3 py-1 text-sm font-bold text-primary">
                    {Number(r.days)} يوم
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </AppShell>
  );
}
