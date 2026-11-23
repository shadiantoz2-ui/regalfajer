import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export type StaffRole = "admin" | "teacher";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    const list = (roles ?? []).map((r) => r.role);
    const role: StaffRole | null = list.includes("admin") ? "admin" : list.includes("teacher") ? "teacher" : null;
    if (!role) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }
    return { role, userName: String(user.user_metadata?.["full_name"] ?? user.email ?? "") };
  },
  component: StaffLayout,
});

/** Live updates: any device recording attendance refreshes every other open screen. */
function StaffLayout() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`staff-live-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, (payload) => {
        const row = (payload.new && "attended_on" in payload.new ? payload.new : payload.old) as { attended_on?: string };
        if (row?.attended_on) void qc.invalidateQueries({ queryKey: ["attendance", row.attended_on] });
        else void qc.invalidateQueries({ queryKey: ["attendance"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "students" }, () => {
        void qc.invalidateQueries({ queryKey: ["students"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => {
        void qc.invalidateQueries({ queryKey: ["settings"] });
      })
      .subscribe();
    const onFocus = () => void qc.invalidateQueries({ queryKey: ["attendance"] });
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [qc]);
  return <Outlet />;
}
