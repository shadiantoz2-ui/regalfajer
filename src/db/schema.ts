import { relations } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

export const staffAccounts = pgTable("staff_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  role: text("role").notNull(),
  isPrimaryAdmin: boolean("is_primary_admin").notNull().default(false),
  createdById: text("created_by_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const students = pgTable("students", {
  id: text("id").primaryKey(),
  fullName: text("full_name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
  createdById: text("created_by_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const attendance = pgTable(
  "attendance",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    studentName: text("student_name").notNull(),
    attendedOn: text("attended_on").notNull(),
    recordedById: text("recorded_by_id").notNull(),
    recordedByName: text("recorded_by_name").notNull(),
    recordedByUsername: text("recorded_by_username").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_attendance_student_date").on(table.studentId, table.attendedOn),
    index("idx_attendance_date").on(table.attendedOn),
    index("idx_attendance_student").on(table.studentId),
    index("idx_attendance_recorder_date").on(table.recordedById, table.attendedOn),
  ],
);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedById: text("updated_by_id"),
});

export const assistantChats = pgTable("assistant_chats", {
  userId: text("user_id")
    .primaryKey()
    .references(() => staffAccounts.id, { onDelete: "cascade" }),
  messages: text("messages").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const assistantConversations = pgTable(
  "assistant_conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    messageCount: integer("message_count").notNull().default(0),
    lastMessagePreview: text("last_message_preview").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_assistant_conv_user_updated").on(table.userId, table.updatedAt)],
);

export const assistantMessages = pgTable(
  "assistant_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => assistantConversations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    textContent: text("text_content").notNull(),
    partsJson: text("parts_json").notNull(),
    position: integer("position").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_assistant_msg_conv_pos").on(table.conversationId, table.position),
    index("idx_assistant_msg_user").on(table.userId),
  ],
);

export const assistantToolLogs = pgTable(
  "assistant_tool_logs",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").references(() => assistantConversations.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    inputJson: text("input_json").notNull(),
    status: text("status").notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_assistant_tool_user_created").on(table.userId, table.createdAt)],
);

export const assistantNotes = pgTable(
  "assistant_notes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => staffAccounts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_assistant_notes_user_updated").on(table.userId, table.updatedAt)],
);

export const systemConfig = pgTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const studentsRelations = relations(students, ({ many }) => ({
  attendanceRecords: many(attendance),
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  student: one(students, {
    fields: [attendance.studentId],
    references: [students.id],
  }),
}));

export const staffAccountsRelations = relations(staffAccounts, ({ one, many }) => ({
  assistantChat: one(assistantChats, {
    fields: [staffAccounts.id],
    references: [assistantChats.userId],
  }),
  assistantConversations: many(assistantConversations),
  assistantMessages: many(assistantMessages),
  assistantToolLogs: many(assistantToolLogs),
  assistantNotes: many(assistantNotes),
}));

export const assistantChatsRelations = relations(assistantChats, ({ one }) => ({
  staffAccount: one(staffAccounts, {
    fields: [assistantChats.userId],
    references: [staffAccounts.id],
  }),
}));

export const assistantConversationsRelations = relations(assistantConversations, ({ one, many }) => ({
  staffAccount: one(staffAccounts, {
    fields: [assistantConversations.userId],
    references: [staffAccounts.id],
  }),
  messages: many(assistantMessages),
  toolLogs: many(assistantToolLogs),
}));

export const assistantMessagesRelations = relations(assistantMessages, ({ one }) => ({
  conversation: one(assistantConversations, {
    fields: [assistantMessages.conversationId],
    references: [assistantConversations.id],
  }),
  staffAccount: one(staffAccounts, {
    fields: [assistantMessages.userId],
    references: [staffAccounts.id],
  }),
}));

export const assistantToolLogsRelations = relations(assistantToolLogs, ({ one }) => ({
  conversation: one(assistantConversations, {
    fields: [assistantToolLogs.conversationId],
    references: [assistantConversations.id],
  }),
  staffAccount: one(staffAccounts, {
    fields: [assistantToolLogs.userId],
    references: [staffAccounts.id],
  }),
}));

export const assistantNotesRelations = relations(assistantNotes, ({ one }) => ({
  staffAccount: one(staffAccounts, {
    fields: [assistantNotes.userId],
    references: [staffAccounts.id],
  }),
}));
