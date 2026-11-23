import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CalendarClock, Mic, Users } from "lucide-react";
import logo from "@/assets/rijal-alfajr-logo.webp.asset.json";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "الحضور", icon: Mic },
  { to: "/students", label: "الطلاب", icon: Users },
  { to: "/records", label: "السجل والتحميل", icon: CalendarClock },
] as const;

export function AppShell({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <div className="relative min-h-dvh overflow-x-hidden pb-28 md:pb-12">
      <div aria-hidden className="stars pointer-events-none fixed inset-0 opacity-80" />
      <header className="relative mx-auto flex max-w-3xl flex-col items-center px-5 pt-8 text-center">
        <Link to="/" className="group flex flex-col items-center">
          <img
            src={logo.url}
            alt="شعار مسجد الغفران"
            className={cn(
              "drop-shadow-[0_10px_30px_color-mix(in_oklab,var(--primary)_35%,transparent)] transition-transform duration-500 group-hover:scale-105",
              compact ? "h-20 w-20" : "h-32 w-32 md:h-40 md:w-40",
            )}
          />
          <h1
            className={cn(
              "font-display text-gradient-gold leading-tight",
              compact ? "mt-1 text-3xl" : "mt-2 text-5xl md:text-6xl",
            )}
          >
            رجال الفجر
          </h1>
        </Link>
        <nav className="mt-6 hidden gap-2 rounded-full p-1.5 surface md:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: true }}
              className="flex items-center gap-2 rounded-full px-5 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{ className: "!bg-gradient-gold !text-primary-foreground font-semibold shadow-gold" }}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="relative mx-auto mt-6 max-w-3xl px-4">{children}</main>

      <nav className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-3 gap-1 rounded-3xl p-1.5 surface md:hidden">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: true }}
            className="flex flex-col items-center gap-1 rounded-2xl py-2 text-[11px] text-muted-foreground transition-colors"
            activeProps={{ className: "!bg-gradient-gold !text-primary-foreground font-semibold" }}
          >
            <item.icon className="size-5" />
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
