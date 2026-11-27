import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

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

export const staffAccountsRelations = relations(staffAccounts, ({ one }) => ({
  assistantChat: one(assistantChats, {
    fields: [staffAccounts.id],
    references: [assistantChats.userId],
  }),
}));

export const assistantChatsRelations = relations(assistantChats, ({ one }) => ({
  staffAccount: one(staffAccounts, {
    fields: [assistantChats.userId],
    references: [staffAccounts.id],
  }),
}));
