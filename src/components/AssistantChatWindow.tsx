import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from "ai";
import { BarChart3, CalendarSearch, Info, ListOrdered, MessageSquarePlus, UserSearch } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { AlGhufranLogo } from "@/components/AlGhufranLogo";
import { Button } from "@/components/ui/button";
import { getSessionBearerToken } from "@/lib/api-client";
import { localDateKey } from "@/lib/arabic";
import { clearAssistantChat, readableChatError } from "@/lib/assistant-chat";

const TOOL_LABELS: Record<string, { label: string; icon: typeof Info }> = {
  overview: { label: "قراءة الإحصائيات العامة", icon: BarChart3 },
  find_student: { label: "البحث عن طالب", icon: UserSearch },
  attendance_on_date: { label: "حضور يوم محدد", icon: CalendarSearch },
  ranking: { label: "ترتيب الطلاب حسب الحضور", icon: ListOrdered },
  daily_counts: { label: "عدد الحضور لكل يوم", icon: BarChart3 },
};

const SUGGESTIONS = [
  "من أكثر 10 طلاب حضوراً؟",
  "من حضر اليوم ومن غاب؟",
  "كم يوماً حضر الطالب ...؟",
  "ما متوسط عدد الحضور يومياً هذا الشهر؟",
];

export default function AssistantChatWindow({ initial }: { initial: UIMessage[] }) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/assistant",
        credentials: "include",
        headers: () => {
          const bearer = getSessionBearerToken();
          return {
            "X-Requested-With": "rijal-client",
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          };
        },
        body: () => ({ today: localDateKey() }),
      }),
    [],
  );
  const { messages, sendMessage, status, stop, setMessages, error, clearError } = useChat({
    id: "rijal-assistant",
    messages: initial,
    transport,
    onError: (e) => toast.error(readableChatError(e)),
  });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const last = messages.at(-1);
  const waiting =
    status === "submitted" ||
    (status === "streaming" && last?.role === "assistant" && !last.parts.some((p) => p.type === "text" && p.text));

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    clearError();
    void sendMessage({ text: t });
  };

  /** Questions ending in "..." need a name, so they go into the box instead of being sent. */
  const pickSuggestion = (s: string) => {
    const el = inputRef.current;
    if (!s.includes("...")) return send(s);
    if (!el) return;
    el.value = s.replace("...", "").trimEnd() + " ";
    el.focus();
  };

  const newConversation = async () => {
    if (busy) await stop();
    try {
      clearError();
      await clearAssistantChat();
      setMessages([]);
      inputRef.current?.focus();
    } catch {
      toast.error("تعذّر بدء محادثة جديدة");
    }
  };

  return (
    <section className="flex h-[calc(100dvh-15rem)] min-h-[26rem] flex-col overflow-hidden rounded-[2rem] surface md:h-[calc(100dvh-17rem)]">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <AlGhufranLogo className="size-9 rounded-full bg-background/40 p-0.5" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg leading-snug">مساعد رجال الفجر</p>
          <p className="truncate text-xs text-muted-foreground">اسأل عن الطلاب وأيام الحضور</p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={newConversation} className="gap-1.5 text-muted-foreground hover:text-primary">
            <MessageSquarePlus className="size-4" /> محادثة جديدة
          </Button>
        )}
      </div>

      <Conversation className="flex-1">
        <ConversationContent className="gap-6 px-4 py-5">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center">
              <AlGhufranLogo compact />
              <p className="font-display mt-3 pb-1 text-2xl leading-normal text-gradient-gold">كيف أساعدك؟</p>
              <p className="mt-1 text-sm text-muted-foreground">أجيبك عن أي معلومة في الموقع: الحضور، الغياب، الترتيب، والإحصائيات</p>
              <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => pickSuggestion(s)}
                    className="cursor-pointer rounded-2xl border border-border bg-background/30 px-4 py-3 text-start text-sm transition-colors hover:border-primary/60 hover:text-primary"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <Message key={m.id} from={m.role}>
                <MessageContent className="text-[15px] leading-7 group-[.is-user]:rounded-2xl group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground">
                  {m.parts.map((part, i) => {
                    if (part.type === "text") {
                      return m.role === "assistant" ? (
                        <MessageResponse key={i} dir="auto">
                          {part.text}
                        </MessageResponse>
                      ) : (
                        <p key={i} className="whitespace-pre-wrap">
                          {part.text}
                        </p>
                      );
                    }
                    if (isToolUIPart(part)) {
                      const name = getToolName(part);
                      const meta = TOOL_LABELS[name];
                      return (
                        <Tool key={i} defaultOpen={false} className="mb-0 border-border bg-background/30">
                          <ToolHeader type={part.type as `tool-${string}`} state={part.state} title={meta?.label ?? name} />
                          <ToolContent>
                            <ToolInput input={part.input} />
                            <ToolOutput output={part.output} errorText={part.errorText} />
                          </ToolContent>
                        </Tool>
                      );
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            ))
          )}
          {waiting && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer>يبحث في بيانات الحضور...</Shimmer>
              </MessageContent>
            </Message>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <span>{readableChatError(error)}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => clearError()} className="shrink-0 text-destructive hover:text-destructive">
                إغلاق
              </Button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border p-3">
        <PromptInput onSubmit={({ text }) => send(text)}>
          <PromptInputTextarea ref={inputRef} autoFocus placeholder="اكتب سؤالك هنا..." className="text-base" dir="auto" />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit status={status} onStop={() => void stop()} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </section>
  );
}
