import { randomUUID } from "node:crypto";
import type { UIMessage } from "ai";
import { and, asc, count, desc, eq } from "drizzle-orm";
import {
  deriveConversationTitle,
  deriveLastMessagePreview,
  extractMessageText,
  normalizeStoredMessageRows,
  validateAssistantNoteInput,
  type AssistantConversationSummary,
  type AssistantDbStats,
  type AssistantNoteItem,
} from "@/lib/assistant-helpers";
import { db } from "../../db/index.ts";
import {
  assistantChats,
  assistantConversations,
  assistantMessages,
  assistantNotes,
  assistantToolLogs,
} from "../../db/schema.ts";

function sanitizeConversationId(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return trimmed;
}

async function migrateLegacyAssistantChatIfNeeded(userId: string): Promise<void> {
  const [convCountRows, legacyRows] = await Promise.all([
    db
      .select({ cnt: count() })
      .from(assistantConversations)
      .where(eq(assistantConversations.userId, userId)),
    db
      .select({ messages: assistantChats.messages, updatedAt: assistantChats.updatedAt })
      .from(assistantChats)
      .where(eq(assistantChats.userId, userId))
      .limit(1),
  ]);

  if (Number(convCountRows[0]?.cnt ?? 0) > 0) return;

  const legacy = legacyRows[0];
  if (!legacy?.messages) return;

  let parsed: UIMessage[] = [];
  try {
    const raw = JSON.parse(legacy.messages) as unknown;
    if (Array.isArray(raw)) parsed = raw as UIMessage[];
  } catch {
    return;
  }
  if (parsed.length === 0) return;

  const convId = randomUUID();
  await saveAssistantConversationMessages(userId, convId, parsed, legacy.updatedAt);
}

export async function listAssistantConversations(userId: string): Promise<AssistantConversationSummary[]> {
  try {
    await migrateLegacyAssistantChatIfNeeded(userId);
    const rows = await db
      .select({
        id: assistantConversations.id,
        title: assistantConversations.title,
        messageCount: assistantConversations.messageCount,
        lastMessagePreview: assistantConversations.lastMessagePreview,
        createdAt: assistantConversations.createdAt,
        updatedAt: assistantConversations.updatedAt,
      })
      .from(assistantConversations)
      .where(eq(assistantConversations.userId, userId))
      .orderBy(desc(assistantConversations.updatedAt));
    return rows;
  } catch (error) {
    console.error("Failed to list assistant conversations:", error);
    throw new Error("تعذّر تحميل سجل محادثات المساعد", { cause: error });
  }
}

export async function getAssistantConversationMessages(
  userId: string,
  requestedConversationId?: string | null,
): Promise<{
  conversations: AssistantConversationSummary[];
  activeConversationId: string | null;
  messages: UIMessage[];
}> {
  try {
    const conversations = await listAssistantConversations(userId);
    if (conversations.length === 0) {
      return { conversations: [], activeConversationId: null, messages: [] };
    }

    const cleanId = sanitizeConversationId(requestedConversationId);
    const selected =
      (cleanId ? conversations.find((c) => c.id === cleanId) : undefined) ?? conversations[0]!;

    const msgRows = await db
      .select({
        id: assistantMessages.id,
        role: assistantMessages.role,
        partsJson: assistantMessages.partsJson,
        textContent: assistantMessages.textContent,
      })
      .from(assistantMessages)
      .where(
        and(
          eq(assistantMessages.conversationId, selected.id),
          eq(assistantMessages.userId, userId),
        ),
      )
      .orderBy(asc(assistantMessages.position));

    return {
      conversations,
      activeConversationId: selected.id,
      messages: normalizeStoredMessageRows(msgRows),
    };
  } catch (error) {
    console.error("Failed to fetch assistant conversation messages:", error);
    throw new Error("تعذّر تحميل محادثة المساعد", { cause: error });
  }
}

export async function createAssistantConversation(
  userId: string,
  rawTitle?: string,
): Promise<AssistantConversationSummary> {
  try {
    const id = randomUUID();
    const nowIso = new Date().toISOString();
    const title = rawTitle?.trim() ? rawTitle.trim().slice(0, 60) : "محادثة جديدة";
    await db.insert(assistantConversations).values({
      id,
      userId,
      title,
      messageCount: 0,
      lastMessagePreview: "",
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    return {
      id,
      title,
      messageCount: 0,
      lastMessagePreview: "",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (error) {
    console.error("Failed to create assistant conversation:", error);
    throw new Error("تعذّر إنشاء محادثة جديدة", { cause: error });
  }
}

export async function saveAssistantConversationMessages(
  userId: string,
  requestedConversationId: string | null | undefined,
  messages: readonly UIMessage[],
  overrideUpdatedAt?: string,
): Promise<string> {
  try {
    const nowIso = overrideUpdatedAt ?? new Date().toISOString();
    const cleanId = sanitizeConversationId(requestedConversationId) ?? randomUUID();
    const title = deriveConversationTitle(messages);
    const preview = deriveLastMessagePreview(messages);
    const serializedAll = JSON.stringify(messages);

    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: assistantConversations.id, userId: assistantConversations.userId })
        .from(assistantConversations)
        .where(eq(assistantConversations.id, cleanId))
        .limit(1);

      const targetConvId =
        existing[0] && existing[0].userId !== userId ? randomUUID() : cleanId;

      if (!existing[0] || targetConvId !== cleanId) {
        await tx.insert(assistantConversations).values({
          id: targetConvId,
          userId,
          title,
          messageCount: messages.length,
          lastMessagePreview: preview,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      } else {
        await tx
          .update(assistantConversations)
          .set({
            title,
            messageCount: messages.length,
            lastMessagePreview: preview,
            updatedAt: nowIso,
          })
          .where(
            and(
              eq(assistantConversations.id, targetConvId),
              eq(assistantConversations.userId, userId),
            ),
          );
      }

      await tx
        .delete(assistantMessages)
        .where(
          and(
            eq(assistantMessages.conversationId, targetConvId),
            eq(assistantMessages.userId, userId),
          ),
        );

      if (messages.length > 0) {
        const msgValues = messages.map((m, index) => {
          const textContent = extractMessageText(m.parts);
          const msgId = m.id && m.id.trim() ? `${targetConvId}:${m.id.trim()}` : randomUUID();
          return {
            id: msgId,
            conversationId: targetConvId,
            userId,
            role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user",
            textContent,
            partsJson: JSON.stringify(m.parts ?? []),
            position: index,
            createdAt: nowIso,
          };
        });
        // Ensure unique IDs in case duplicate message IDs ever appear
        const seenIds = new Set<string>();
        const deduped = msgValues.map((row, idx) => {
          if (!seenIds.has(row.id)) {
            seenIds.add(row.id);
            return row;
          }
          const uniqueId = `${row.id}_${idx}`;
          seenIds.add(uniqueId);
          return { ...row, id: uniqueId };
        });
        await tx.insert(assistantMessages).values(deduped);
      }

      await tx
        .insert(assistantChats)
        .values({
          userId,
          messages: serializedAll,
          updatedAt: nowIso,
        })
        .onConflictDoUpdate({
          target: assistantChats.userId,
          set: {
            messages: serializedAll,
            updatedAt: nowIso,
          },
        });
    });

    return cleanId;
  } catch (error) {
    console.error("Failed to save assistant conversation:", error);
    throw new Error("تعذّر حفظ محادثة المساعد", { cause: error });
  }
}

export async function deleteAssistantConversation(
  userId: string,
  conversationId: string,
): Promise<boolean> {
  try {
    const deleted = await db
      .delete(assistantConversations)
      .where(
        and(
          eq(assistantConversations.id, conversationId),
          eq(assistantConversations.userId, userId),
        ),
      )
      .returning({ id: assistantConversations.id });
    return deleted.length > 0;
  } catch (error) {
    console.error("Failed to delete assistant conversation:", error);
    throw new Error("تعذّر حذف المحادثة", { cause: error });
  }
}

export async function clearAllAssistantConversations(userId: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(assistantConversations).where(eq(assistantConversations.userId, userId));
      await tx.delete(assistantChats).where(eq(assistantChats.userId, userId));
    });
  } catch (error) {
    console.error("Failed to clear assistant conversations:", error);
    throw new Error("تعذّر مسح محادثات المساعد", { cause: error });
  }
}

export async function logAssistantToolRun(input: {
  userId: string;
  conversationId?: string | null;
  toolName: string;
  args: Record<string, unknown>;
  status: "ok" | "error";
  durationMs: number;
}): Promise<void> {
  try {
    let validConvId: string | null = null;
    if (input.conversationId) {
      const found = await db
        .select({ id: assistantConversations.id })
        .from(assistantConversations)
        .where(
          and(
            eq(assistantConversations.id, input.conversationId),
            eq(assistantConversations.userId, input.userId),
          ),
        )
        .limit(1);
      if (found[0]) validConvId = found[0].id;
    }

    await db.insert(assistantToolLogs).values({
      id: randomUUID(),
      conversationId: validConvId,
      userId: input.userId,
      toolName: input.toolName,
      inputJson: JSON.stringify(input.args ?? {}),
      status: input.status,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to log assistant tool run:", error);
  }
}

export async function listAssistantNotes(userId: string): Promise<AssistantNoteItem[]> {
  try {
    return await db
      .select({
        id: assistantNotes.id,
        title: assistantNotes.title,
        content: assistantNotes.content,
        createdAt: assistantNotes.createdAt,
        updatedAt: assistantNotes.updatedAt,
      })
      .from(assistantNotes)
      .where(eq(assistantNotes.userId, userId))
      .orderBy(desc(assistantNotes.updatedAt));
  } catch (error) {
    console.error("Failed to list assistant notes:", error);
    throw new Error("تعذّر تحميل ملاحظات المساعد", { cause: error });
  }
}

export async function createAssistantNote(
  userId: string,
  input: { title: string; content: string },
): Promise<{ ok: true; note: AssistantNoteItem } | { ok: false; error: string }> {
  const validated = validateAssistantNoteInput(input);
  if (!validated.ok) return validated;

  try {
    const id = randomUUID();
    const nowIso = new Date().toISOString();
    await db.insert(assistantNotes).values({
      id,
      userId,
      title: validated.title,
      content: validated.content,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    return {
      ok: true,
      note: {
        id,
        title: validated.title,
        content: validated.content,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    };
  } catch (error) {
    console.error("Failed to create assistant note:", error);
    throw new Error("تعذّر حفظ الملاحظة في قاعدة المساعد", { cause: error });
  }
}

export async function deleteAssistantNote(userId: string, noteId: string): Promise<boolean> {
  try {
    const deleted = await db
      .delete(assistantNotes)
      .where(and(eq(assistantNotes.id, noteId), eq(assistantNotes.userId, userId)))
      .returning({ id: assistantNotes.id });
    return deleted.length > 0;
  } catch (error) {
    console.error("Failed to delete assistant note:", error);
    throw new Error("تعذّر حذف الملاحظة", { cause: error });
  }
}

export async function getAssistantDbStats(userId: string): Promise<AssistantDbStats> {
  try {
    const [convRows, msgRows, noteRows, toolRows] = await Promise.all([
      db
        .select({ cnt: count() })
        .from(assistantConversations)
        .where(eq(assistantConversations.userId, userId)),
      db
        .select({ cnt: count() })
        .from(assistantMessages)
        .where(eq(assistantMessages.userId, userId)),
      db
        .select({ cnt: count() })
        .from(assistantNotes)
        .where(eq(assistantNotes.userId, userId)),
      db
        .select({ cnt: count() })
        .from(assistantToolLogs)
        .where(eq(assistantToolLogs.userId, userId)),
    ]);

    return {
      conversations: Number(convRows[0]?.cnt ?? 0),
      messages: Number(msgRows[0]?.cnt ?? 0),
      notes: Number(noteRows[0]?.cnt ?? 0),
      toolRuns: Number(toolRows[0]?.cnt ?? 0),
    };
  } catch (error) {
    console.error("Failed to read assistant database stats:", error);
    throw new Error("تعذّر قراءة إحصائيات قاعدة المساعد", { cause: error });
  }
}
