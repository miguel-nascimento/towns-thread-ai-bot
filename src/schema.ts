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
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
