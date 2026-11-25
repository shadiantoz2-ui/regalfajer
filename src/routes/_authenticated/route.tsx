import { createFileRoute, Outlet, redirect, useNavigate, type ErrorComponentProps } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ApiError, setSessionBearerToken } from "@/lib/api-client";
import { fetchAuthState } from "@/lib/data";
import type { StaffRole } from "@/lib/types";

export type { StaffRole };

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ context }) => {
    return context.queryClient.ensureQueryData({
      queryKey: ["staff-session"],
      staleTime: 60_000,
      queryFn: async () => {
        const state = await fetchAuthState();
        if (!state.user) {
          throw redirect({ to: "/auth" });
        }
        return {
          uid: state.user.id,
          username: state.user.username,
          role: state.user.role,
          userName: state.user.name,
          isPrimaryAdmin: state.user.isPrimaryAdmin,
        };
      },
    });
  },
  errorComponent: StaffAuthErrorBoundary,
  component: StaffLayout,
});

function StaffAuthErrorBoundary({ error, reset }: ErrorComponentProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isAuthError = error instanceof ApiError && error.status === 401;

  useEffect(() => {
    if (!isAuthError) return;
    setSessionBearerToken(null);
    qc.removeQueries({ queryKey: ["staff-session"] });
    void navigate({ to: "/auth", replace: true });
  }, [isAuthError, navigate, qc]);

  if (isAuthError) {
    return null;
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-6 text-center">
      <div className="max-w-md rounded-3xl p-6 surface">
        <p className="font-display text-xl text-foreground">تعذّر تحميل الصفحة</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "حدث خطأ غير متوقع، حاول مرة أخرى"}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 cursor-pointer rounded-xl bg-gradient-gold px-5 py-2 text-sm font-semibold text-primary-foreground"
        >
          إعادة المحاولة
        </button>
      </div>
    </div>
  );
}

function StaffLayout() {
  const qc = useQueryClient();

  useEffect(() => {
    const onFocus = () => {
      void qc.invalidateQueries({ queryKey: ["attendance"] });
      void qc.invalidateQueries({ queryKey: ["students"] });
      void qc.invalidateQueries({ queryKey: ["my-day-recordings"] });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [qc]);

  return <Outlet />;
}
