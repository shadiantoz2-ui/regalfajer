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
        <section className="flex flex-col items-center rounded-[2rem] p-10 text-center surface">
          <Lock className="size-12 text-primary" />
          <p className="font-display mt-4 text-2xl">النتائج غير متاحة حالياً</p>
          <p className="mt-2 text-muted-foreground">ستظهر هنا عندما يفتحها المدير</p>
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
