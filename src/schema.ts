import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const messages = sqliteTable("messages", {
  eventId: text("event_id").primaryKey(),
  threadId: text("thread_id").notNull(),
  channelId: text("channel_id").notNull(),
  spaceId: text("space_id").notNull(),
  userId: text("user_id").notNull(),
  message: text("message").notNull(),
  replyId: text("reply_id"),
  isMentioned: integer("is_mentioned", { mode: "boolean" }).default(false),
  mentions: text("mentions", { mode: "json" }).$type<
    Array<{ userId: string; displayName: string }>
  >(),
  isThreadStarter: integer("is_thread_starter", { mode: "boolean" }).default(
    false
  ),
  isAskThread: integer("is_ask_thread", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const pendingToolcalls = sqliteTable("pending_toolcalls", {
  id: text("id").primaryKey(),
  draftEventId: text("draft_event_id")
    .notNull()
    .references(() => messages.eventId),
  originalEventId: text("original_event_id")
    .notNull()
    .references(() => messages.eventId),
  toolName: text("tool_name").notNull(),
  toolArgs: text("tool_args", { mode: "json" }).notNull(),
  status: text("status")
    .$type<"pending" | "approved" | "rejected">()
    .default("pending"),
});

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type PendingToolcall = typeof pendingToolcalls.$inferSelect;
export type NewPendingToolcall = typeof pendingToolcalls.$inferInsert;
