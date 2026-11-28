import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport, getToolName, isToolUIPart } from "ai";
import {
  BarChart3,
  BookMarked,
  CalendarSearch,
  History,
  Info,
  ListOrdered,
  MessageSquarePlus,
  Plus,
  Trash2,
  UserSearch,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { AlGhufranLogo } from "@/components/AlGhufranLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSessionBearerToken, apiJson } from "@/lib/api-client";
import { localDateKey } from "@/lib/arabic";
import {
  createAssistantConversationApi,
  createAssistantNoteApi,
  deleteAssistantConversationApi,
  deleteAssistantNoteApi,
  readableChatError,
  type AssistantChatPayload,
} from "@/lib/assistant-chat";
import type { AssistantConversationSummary, AssistantNoteItem } from "@/lib/assistant-helpers";

const TOOL_LABELS: Record<string, { label: string; icon: typeof Info }> = {
  overview: { label: "قراءة الإحصائيات العامة", icon: BarChart3 },
  find_student: { label: "البحث عن طالب", icon: UserSearch },
  attendance_on_date: { label: "حضور يوم محدد", icon: CalendarSearch },
  ranking: { label: "ترتيب الطلاب حسب الحضور", icon: ListOrdered },
  daily_counts: { label: "عدد الحضور لكل يوم", icon: BarChart3 },
  list_notes: { label: "قراءة ملاحظات المساعد", icon: BookMarked },
  save_note: { label: "حفظ ملاحظة جديدة", icon: BookMarked },
};

const SUGGESTIONS = [
  "من أكثر 10 طلاب حضوراً؟",
  "من حضر اليوم ومن غاب؟",
  "كم يوماً حضر الطالب ...؟",
  "ما متوسط عدد الحضور يومياً هذا الشهر؟",
];

export default function AssistantChatWindow({ initialData }: { initialData: AssistantChatPayload }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [conversations, setConversations] = useState<AssistantConversationSummary[]>(initialData.conversations);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(initialData.activeConversationId);
  const [notes, setNotes] = useState<AssistantNoteItem[]>(initialData.notes);
  const [activePanel, setActivePanel] = useState<"none" | "history" | "notes">("none");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [creatingConv, setCreatingConv] = useState(false);

  const activeConversationIdRef = useRef<string | null>(activeConversationId);
  activeConversationIdRef.current = activeConversationId;

  const refreshAssistantMeta = async (targetConversationId?: string | null) => {
    try {
      const qs = targetConversationId ? `?conversationId=${encodeURIComponent(targetConversationId)}` : "";
      const fresh = await apiJson<AssistantChatPayload>(`/api/assistant-chat${qs}`);
      setConversations(fresh.conversations);
      setNotes(fresh.notes);
      qc.setQueryData(["assistant-chat", "latest"], fresh);
    } catch {
      /* background sync error ignored */
    }
  };

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
        body: () => ({
          today: localDateKey(),
          ...(activeConversationIdRef.current ? { conversationId: activeConversationIdRef.current } : {}),
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, stop, setMessages, error, clearError } = useChat({
    id: activeConversationId ?? "rijal-assistant",
    messages: initialData.messages,
    transport,
    onFinish: () => {
      void refreshAssistantMeta(activeConversationIdRef.current);
    },
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

  const ensureConversationId = async (): Promise<string | null> => {
    if (activeConversationIdRef.current) return activeConversationIdRef.current;
    try {
      const created = await createAssistantConversationApi();
      setConversations((prev) => [created, ...prev]);
      setActiveConversationId(created.id);
      activeConversationIdRef.current = created.id;
      return created.id;
    } catch {
      return null;
    }
  };

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    clearError();
    await ensureConversationId();
    void sendMessage({ text: t });
  };

  /** Questions ending in "..." need a name, so they go into the box instead of being sent. */
  const pickSuggestion = (s: string) => {
    const el = inputRef.current;
    if (!s.includes("...")) {
      void send(s);
      return;
    }
    if (!el) return;
    el.value = s.replace("...", "").trimEnd() + " ";
    el.focus();
  };

  const newConversation = async () => {
    if (busy || creatingConv) return;
    setCreatingConv(true);
    try {
      clearError();
      const created = await createAssistantConversationApi();
      setConversations((prev) => [created, ...prev]);
      setActiveConversationId(created.id);
      activeConversationIdRef.current = created.id;
      setMessages([]);
      setActivePanel("none");
      inputRef.current?.focus();
    } catch {
      toast.error("تعذّر بدء محادثة جديدة");
    } finally {
      setCreatingConv(false);
    }
  };

  const selectConversation = async (conversationId: string) => {
    if (busy || conversationId === activeConversationId) return;
    try {
      clearError();
      const data = await apiJson<AssistantChatPayload>(
        `/api/assistant-chat?conversationId=${encodeURIComponent(conversationId)}`,
      );
      setConversations(data.conversations);
      setActiveConversationId(data.activeConversationId);
      activeConversationIdRef.current = data.activeConversationId;
      setMessages(data.messages);
      setActivePanel("none");
    } catch {
      toast.error("تعذّر تحميل المحادثة");
    }
  };

  const removeConversation = async (conversationId: string) => {
    if (busy) return;
    try {
      await deleteAssistantConversationApi(conversationId);
      const remaining = conversations.filter((c) => c.id !== conversationId);
      setConversations(remaining);
      if (activeConversationId === conversationId) {
        const nextId = remaining[0]?.id ?? null;
        if (nextId) {
          await selectConversation(nextId);
        } else {
          setActiveConversationId(null);
          activeConversationIdRef.current = null;
          setMessages([]);
        }
      }
      toast.success("تم حذف المحادثة");
    } catch {
      toast.error("تعذّر حذف المحادثة");
    }
  };

  const handleAddNote = async (e: FormEvent) => {
    e.preventDefault();
    const title = noteTitle.trim();
    const content = noteContent.trim();
    if (title.length < 2 || content.length < 2) {
      toast.error("أدخل عنوان الملاحظة ومحتواها");
      return;
    }
    setSavingNote(true);
    try {
      const created = await createAssistantNoteApi({ title, content });
      setNotes((prev) => [created, ...prev]);
      setNoteTitle("");
      setNoteContent("");
      toast.success("تم حفظ الملاحظة في قاعدة المساعد");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر حفظ الملاحظة");
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      await deleteAssistantNoteApi(noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success("تم حذف الملاحظة");
    } catch {
      toast.error("تعذّر حذف الملاحظة");
    }
  };

  return (
    <section className="flex h-[calc(100dvh-15rem)] min-h-[26rem] flex-col overflow-hidden rounded-[2rem] surface md:h-[calc(100dvh-17rem)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <AlGhufranLogo compact className="!size-9 shrink-0 rounded-full bg-background/40 p-0.5" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg leading-snug">مساعد رجال الفجر</p>
          <p className="truncate text-xs text-muted-foreground">اسأل عن الطلاب وأيام الحضور</p>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={activePanel === "history" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActivePanel((p) => (p === "history" ? "none" : "history"))}
            className="gap-1.5 text-muted-foreground hover:text-primary"
          >
            <History className="size-4" />
            <span className="hidden sm:inline">السجل</span>
            {conversations.length > 0 && (
              <span className="text-[11px] opacity-80">({conversations.length})</span>
            )}
          </Button>

          <Button
            type="button"
            variant={activePanel === "notes" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActivePanel((p) => (p === "notes" ? "none" : "notes"))}
            className="gap-1.5 text-muted-foreground hover:text-primary"
          >
            <BookMarked className="size-4" />
            <span className="hidden sm:inline">الملاحظات</span>
            {notes.length > 0 && <span className="text-[11px] opacity-80">({notes.length})</span>}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={creatingConv}
            onClick={newConversation}
            className="gap-1.5 text-muted-foreground hover:text-primary"
          >
            <MessageSquarePlus className="size-4" />
            <span className="hidden sm:inline">محادثة جديدة</span>
          </Button>
        </div>
      </div>

      {activePanel === "history" && (
        <div className="max-h-60 overflow-y-auto border-b border-border bg-background/45 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">المحادثات المحفوظة</p>
            <button
              type="button"
              onClick={() => setActivePanel("none")}
              aria-label="إغلاق السجل"
              className="rounded-lg p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          {conversations.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">لا توجد محادثات محفوظة بعد</p>
          ) : (
            <ul className="grid gap-1.5">
              {conversations.map((conv) => (
                <li
                  key={conv.id}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                    conv.id === activeConversationId
                      ? "border-primary/60 bg-primary/10 text-foreground"
                      : "border-border bg-background/30 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void selectConversation(conv.id)}
                    className="min-w-0 flex-1 cursor-pointer text-start"
                  >
                    <p className="truncate font-medium text-foreground">{conv.title}</p>
                    {conv.lastMessagePreview && (
                      <p className="truncate text-xs text-muted-foreground">{conv.lastMessagePreview}</p>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeConversation(conv.id)}
                    aria-label={`حذف محادثة ${conv.title}`}
                    className="shrink-0 cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activePanel === "notes" && (
        <div className="max-h-72 overflow-y-auto border-b border-border bg-background/45 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-foreground">ملاحظات وتعليمات محفوظة للمساعد</p>
            <button
              type="button"
              onClick={() => setActivePanel("none")}
              aria-label="إغلاق الملاحظات"
              className="rounded-lg p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          <form onSubmit={handleAddNote} className="mb-3 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <Input
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="عنوان الملاحظة"
              className="h-9 rounded-xl bg-background/60 text-xs"
              maxLength={80}
              required
            />
            <Input
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="مثال: يوم الجمعة حضوره مضاعف في التقييم"
              className="h-9 rounded-xl bg-background/60 text-xs"
              maxLength={1000}
              required
            />
            <Button type="submit" size="sm" variant="gold" disabled={savingNote} className="h-9 gap-1 rounded-xl">
              <Plus className="size-3.5" /> حفظ
            </Button>
          </form>

          {notes.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">
              أضف أي قاعدة أو ملاحظة ليعتمد عليها المساعد في إجاباته دائماً
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {notes.map((note) => (
                <li
                  key={note.id}
                  className="flex items-start justify-between gap-2 rounded-xl border border-border bg-background/30 px-3 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">{note.title}</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{note.content}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDeleteNote(note.id)}
                    aria-label={`حذف ملاحظة ${note.title}`}
                    className="shrink-0 cursor-pointer rounded-lg p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
