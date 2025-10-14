import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { messages } from "./schema.js";
import { eq, asc, and } from "drizzle-orm";

export type Context = {
  initialPrompt: string;
  userId: string;
  conversation: { userId: string; message: string }[];
};

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const db = drizzle(client);

export const addMessage = async (
  eventId: string,
  threadId: string,
  userId: string,
  message: string,
  isThreadStarter = false
) => {
  try {
    await db.insert(messages).values({
      eventId,
      threadId,
      userId,
      message,
      isThreadStarter,
    });
  } catch (error) {
    console.error("Failed to add message:", {
      eventId,
      threadId,
      userId: userId.slice(0, 8) + "...",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

export const getContext = async (threadId: string): Promise<Context | null> => {
  try {
    const messagesResult = await db
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt));

    if (messagesResult.length === 0) {
      return null;
    }

    const starterMessage = messagesResult.find(
      (row) => row.isThreadStarter === true
    );
    if (!starterMessage) {
      return null;
    }

    const conversation = messagesResult.map((row) => ({
      userId: row.userId,
      message: row.message,
    }));

    return {
      initialPrompt: starterMessage.message,
      userId: starterMessage.userId,
      conversation,
    };
  } catch (error) {
    console.error("Failed to get context:", {
      threadId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

export const threadExists = async (threadId: string): Promise<boolean> => {
  try {
    const result = await db
      .select({ eventId: messages.eventId })
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .limit(1);

    return result.length > 0;
  } catch (error) {
    console.error("Failed to check if thread exists:", {
      threadId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

export const getFirstMessageOfThread = async (threadId: string) => {
  try {
    const starterResult = await db
      .select()
      .from(messages)
      .where(
        and(eq(messages.eventId, threadId), eq(messages.isThreadStarter, true))
      )
      .limit(1);

    if (starterResult.length > 0) {
      return starterResult[0];
    }

    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt))
      .limit(1);

    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("Failed to get first message of thread:", {
      threadId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

export const createThreadFromFirstMessage = async (threadId: string) => {
  try {
    const firstMessage = await getFirstMessageOfThread(threadId);
    if (!firstMessage) {
      throw new Error(`No messages found for thread ${threadId}`);
    }

    if (firstMessage.threadId === firstMessage.eventId) {
      await db
        .update(messages)
        .set({ threadId })
        .where(eq(messages.eventId, firstMessage.eventId));
    }
  } catch (error) {
    console.error("Failed to create thread from first message:", {
      threadId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
