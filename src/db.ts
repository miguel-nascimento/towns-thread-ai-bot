import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { messages } from "./schema.js";
import { eq, asc, and, desc } from "drizzle-orm";

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

const askThreadsSet = new Set<string>();

export const saveMessage = async ({
  eventId,
  threadId,
  channelId,
  spaceId,
  userId,
  message,
  createdAt,
  replyId,
  isMentioned,
  mentions,
  isThreadStarter = false,
  isAskThread = false,
}: {
  eventId: string;
  threadId: string;
  channelId: string;
  spaceId: string;
  userId: string;
  message: string;
  createdAt: Date;
  replyId?: string;
  isMentioned?: boolean;
  mentions?: Array<{ userId: string; displayName: string }>;
  isThreadStarter?: boolean;
  isAskThread?: boolean;
}) => {
  try {
    await db.insert(messages).values({
      eventId,
      threadId,
      channelId,
      spaceId,
      userId,
      message,
      replyId,
      isMentioned,
      mentions,
      isThreadStarter,
      isAskThread,
      createdAt,
    });

    if (isAskThread && isThreadStarter) {
      askThreadsSet.add(threadId);
    }
  } catch (error) {
    console.error("Failed to save message:", {
      eventId,
      threadId,
      channelId,
      spaceId,
      userId: userId.slice(0, 8) + "...",
      replyId,
      isMentioned,
      mentionsCount: mentions?.length,
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
        .set({ threadId, isThreadStarter: true })
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

export const getLatestChannelMessages = async (
  channelId: string,
  topLevelLimit: number = 8,
  perThreadLimit: number = 15
) => {
  try {
    const topLevel = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.channelId, channelId),
          eq(messages.isThreadStarter, true)
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(topLevelLimit);

    if (topLevel.length === 0) {
      return [];
    }

    const threadIds = topLevel.map((m) => m.threadId);

    const allMessages = await Promise.all(
      threadIds.map(async (threadId) => {
        const threadMessages = await db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.channelId, channelId),
              eq(messages.threadId, threadId)
            )
          )
          .orderBy(asc(messages.createdAt))
          .limit(perThreadLimit);

        return threadMessages;
      })
    );

    const flattened = allMessages.flat();
    const uniqueMessages = Array.from(
      new Map(flattened.map((m) => [m.eventId, m])).values()
    );

    return uniqueMessages.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
  } catch (error) {
    console.error("Failed to get latest channel messages:", {
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

export const buildEnrichedContext = (
  msgs: Array<typeof messages.$inferSelect>,
  replyLookup: Map<string, string> = new Map()
) => {
  msgs.forEach((msg) => {
    replyLookup.set(msg.eventId, msg.message);
  });

  return msgs.map((msg) => {
    let replyXml = "";
    if (msg.replyId && replyLookup.has(msg.replyId)) {
      const replyMessage = replyLookup.get(msg.replyId)?.slice(0, 100) ?? "";
      replyXml = `<reply>${escapeXml(replyMessage)}</reply>`;
    }

    let mentionsXml = "";
    if (msg.mentions && msg.mentions.length > 0) {
      const mentionList = msg.mentions
        .map((m) => `<mention>${escapeXml(m.displayName)}</mention>`)
        .join("");
      mentionsXml = `<mentions>${mentionList}</mentions>`;
    }

    const messageXml = `<message>${escapeXml(msg.message)}</message>`;

    return `<msg eventId="${escapeXml(
      msg.eventId
    )}">${replyXml}${mentionsXml}${messageXml}</msg>`;
  });
};

// Helper function to escape XML special characters
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const isAskThread = async (threadId: string): Promise<boolean> => {
  if (askThreadsSet.has(threadId)) return true;

  try {
    const result = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.threadId, threadId),
          eq(messages.isThreadStarter, true),
          eq(messages.isAskThread, true)
        )
      )
      .limit(1);

    if (result.length > 0) {
      askThreadsSet.add(threadId);
      return true;
    }

    return false;
  } catch (error) {
    console.error("Failed to check if thread is ask thread:", {
      threadId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};
