import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CalendarClock, LogIn, LogOut, MessageCircleQuestion, Mic, ShieldCheck, Trophy, UserPlus, Users } from "lucide-react";
import { AlGhufranLogo } from "@/components/AlGhufranLogo";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Role = "admin" | "teacher" | null;

const ALL_NAV = [
  { to: "/checkin", label: "الحضور", icon: Mic, roles: ["admin", "teacher"] },
  { to: "/students", label: "الطلاب", icon: Users, roles: ["admin", "teacher"] },
  { to: "/records", label: "السجل", icon: CalendarClock, roles: ["admin"] },
  { to: "/assistant", label: "المساعد", icon: MessageCircleQuestion, roles: ["admin"] },
  { to: "/admin", label: "الإدارة", icon: ShieldCheck, roles: ["admin"] },
] as const;

export function AppShell({
  children,
  compact = false,
  role = null,
  userName,
}: {
  children: ReactNode;
  compact?: boolean;
  role?: Role;
  userName?: string;
}) {
  const nav = role
    ? ALL_NAV.filter((n) => (n.roles as readonly string[]).includes(role)).map((item) =>
        item.to === "/students" && role === "teacher" ? { ...item, label: "إضافة طالب", icon: UserPlus } : item,
      )
    : [];
  const navigate = useNavigate();
  const qc = useQueryClient();

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className={cn("relative min-h-dvh overflow-x-hidden pb-12", nav.length > 1 && "pb-28 md:pb-12")}>
      <div aria-hidden className="stars pointer-events-none fixed inset-0 opacity-80" />

      <div className="relative mx-auto flex max-w-3xl items-center justify-between px-4 pt-4 text-sm">
        {role ? (
          <>
            <span className="truncate text-muted-foreground">
              {role === "admin" ? "المدير" : "المعلم"}
              {userName ? ` · ${userName}` : ""}
            </span>
            <div className="flex items-center gap-1">
              <Link to="/" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-muted-foreground hover:text-primary">
                <Trophy className="size-4" /> النتائج
              </Link>
              <button
                type="button"
                onClick={signOut}
                className="flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-muted-foreground hover:text-destructive"
              >
                <LogOut className="size-4" /> خروج
              </button>
            </div>
          </>
        ) : (
          <>
            <span />
            <Link to="/checkin" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-muted-foreground hover:text-primary">
              <LogIn className="size-4" /> دخول الإدارة
            </Link>
          </>
        )}
      </div>

      <header className="relative mx-auto flex max-w-3xl flex-col items-center px-5 pt-2 text-center">
        <Link to="/" className="group flex flex-col items-center">
          <AlGhufranLogo
            compact={compact}
            className="transition-transform duration-500 group-hover:scale-105"
          />
          <h1
            className={cn(
              // Generous line height + bottom padding: gradient-clipped text otherwise cuts off the letters' tails.
              "font-display text-gradient-gold leading-[1.6] pb-2",
              compact ? "mt-0 text-3xl" : "mt-1 text-5xl md:text-6xl",
            )}
          >
            رجال الفجر
          </h1>
        </Link>
        {nav.length > 1 && (
          <nav className="mt-6 hidden gap-2 rounded-full p-1.5 surface md:flex">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="flex items-center gap-2 rounded-full px-5 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{ className: "!bg-gradient-gold !text-primary-foreground font-semibold shadow-gold" }}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="relative mx-auto mt-6 max-w-3xl px-4">{children}</main>

      {nav.length > 1 && (
        <nav
          className="fixed inset-x-3 bottom-3 z-40 grid gap-1 rounded-3xl p-1.5 surface md:hidden"
          style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}
        >
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex flex-col items-center gap-1 rounded-2xl py-2 text-[11px] text-muted-foreground transition-colors"
              activeProps={{ className: "!bg-gradient-gold !text-primary-foreground font-semibold" }}
            >
              <item.icon className="size-5" />
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
