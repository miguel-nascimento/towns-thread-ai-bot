import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const messages = sqliteTable("messages", {
  eventId: text("event_id").primaryKey(),
  threadId: text("thread_id").notNull(),
  userId: text("user_id").notNull(),
  message: text("message").notNull(),
  isThreadStarter: integer("is_thread_starter", { mode: "boolean" }).default(
    false
  ),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
