import { createFileRoute, redirect } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { type ComponentType, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { assistantChatQuery } from "@/lib/assistant-chat";

type ChatWindowComponent = ComponentType<{ initial: UIMessage[] }>;

const ChatSkeleton = () => (
  <div className="h-[calc(100dvh-15rem)] min-h-[26rem] animate-pulse rounded-[2rem] surface md:h-[calc(100dvh-17rem)]" />
);

export const Route = createFileRoute("/_authenticated/assistant")({
  head: () => ({
    meta: [
      { title: "المساعد الذكي — رجال الفجر" },
      { name: "description", content: "اسأل المساعد الذكي عن الطلاب وأيام الحضور في رجال الفجر." },
      { property: "og:title", content: "المساعد الذكي — رجال الفجر" },
      { property: "og:description", content: "اسأل المساعد الذكي عن الطلاب وأيام الحضور في رجال الفجر." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: ({ context }) => {
    if (context.role !== "admin") throw redirect({ to: "/checkin" });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(assistantChatQuery()),
  component: AssistantPage,
});

function AssistantPage() {
  const { role, userName } = Route.useRouteContext();
  const { data: saved } = useSuspenseQuery(assistantChatQuery());
  const [ChatWindow, setChatWindow] = useState<ChatWindowComponent | null>(null);

  useEffect(() => {
    if (import.meta.env.SSR) return;
    let active = true;
    void import("@/components/AssistantChatWindow").then((mod) => {
      if (active) setChatWindow(() => mod.default);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <AppShell compact role={role} userName={userName}>
      {ChatWindow ? <ChatWindow initial={saved} /> : <ChatSkeleton />}
    </AppShell>
  );
}
