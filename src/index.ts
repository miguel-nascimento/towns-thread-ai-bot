import { generateText, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { makeTownsBot } from "@towns-protocol/bot";
import { Hono } from "hono";
import { logger } from "hono/logger";
import commands from "./commands.js";

import {
  addMessage,
  getContext,
  threadExists,
  createThreadFromFirstMessage,
  getLatestChannelMessages,
  buildEnrichedContext,
  type Context,
} from "./db.js";

const bot = await makeTownsBot(
  process.env.APP_PRIVATE_DATA!,
  process.env.JWT_SECRET!,
  { commands }
);

const shortId = (id: string) => id.slice(0, 4) + ".." + id.slice(-4);

const buildContextMessage = (context: Context, botId: string) => {
  const systemPrompt = `Help users with their questions. Be concise. Context: ${context.initialPrompt}`;

  const messages = context.conversation.map((turn) => ({
    role: turn.userId === botId ? ("assistant" as const) : ("user" as const),
    content: turn.message,
  })) satisfies ModelMessage[];

  return { systemPrompt, messages };
};

const ai = async (context: Context, botId: string) => {
  try {
    const { systemPrompt, messages } = buildContextMessage(context, botId);

    const { text } = await generateText({
      model: openai("gpt-5-nano"),
      system: systemPrompt,
      messages,
      temperature: 0,
    });

    return { ok: true, answer: text };
  } catch (error) {
    console.error("OpenRouter API error:", {
      error: error instanceof Error ? error.message : String(error),
      contextLength: context.conversation.length,
    });
    return { ok: false, answer: "" };
  }
};

// TODO: export this in bot framework lol
type BotHandler = Parameters<Parameters<typeof bot.onMessage>[0]>[0];

const handleAIRequest = async (
  handler: BotHandler,
  params: {
    message: string;
    userId: string;
    eventId: string;
    channelId: string;
    spaceId: string;
    createdAt: Date;
    threadId?: string;
    replyId?: string;
    isMentioned?: boolean;
    mentions?: Array<{ userId: string; displayName: string }>;
  }
) => {
  const {
    message,
    userId,
    eventId,
    channelId,
    spaceId,
    createdAt,
    threadId,
    replyId,
    isMentioned,
    mentions,
  } = params;

  if (threadId) {
    console.log(`📢 AI request in thread: user ${shortId(userId)}:`, message);

    const exists = await threadExists(threadId);
    if (!exists) {
      console.log(`Creating thread ${threadId} from first message`);
      await createThreadFromFirstMessage(threadId);
    }

    await addMessage(
      eventId,
      threadId,
      channelId,
      spaceId,
      userId,
      message,
      createdAt,
      replyId,
      isMentioned,
      mentions
    );

    const context = await getContext(threadId);
    if (!context) {
      console.log("Could not retrieve context for thread");
      return;
    }

    const { ok, answer } = await ai(context, bot.botId);
    if (!ok) {
      await handler.sendMessage(
        channelId,
        "⚠️ AI call failed. Please try again.",
        { threadId }
      );
      return;
    }

    const { eventId: botEventId } = await handler.sendMessage(
      channelId,
      answer,
      { threadId }
    );
    await addMessage(
      botEventId,
      threadId,
      channelId,
      spaceId,
      bot.botId,
      answer,
      new Date(),
      undefined,
      false,
      undefined,
      false
    );
  } else {
    console.log(
      `📢 AI request (new thread): user ${shortId(userId)}:`,
      message
    );

    const newThreadId = eventId;
    await addMessage(
      eventId,
      newThreadId,
      channelId,
      spaceId,
      userId,
      message,
      createdAt,
      replyId,
      isMentioned,
      mentions,
      true
    );

    const context = await getContext(newThreadId);
    if (!context) {
      console.log("Could not retrieve context for new thread");
      return;
    }

    const { ok, answer } = await ai(context, bot.botId);
    if (!ok) {
      await handler.sendMessage(
        channelId,
        "⚠️ AI call failed. Please try again.",
        { threadId: newThreadId }
      );
      return;
    }

    const { eventId: botEventId } = await handler.sendMessage(
      channelId,
      answer,
      { threadId: newThreadId }
    );
    await addMessage(
      botEventId,
      newThreadId,
      channelId,
      spaceId,
      bot.botId,
      answer,
      new Date(),
      undefined,
      false,
      undefined,
      false
    );
  }
};

bot.onMessage(
  async (
    h,
    {
      message,
      userId,
      eventId,
      channelId,
      spaceId,
      createdAt,
      isMentioned,
      threadId,
      replyId,
      mentions,
    }
  ) => {
    try {
      if (isMentioned) {
        await handleAIRequest(h, {
          message,
          userId,
          eventId,
          channelId,
          spaceId,
          createdAt,
          threadId,
          replyId,
          isMentioned,
          mentions,
        });
      } else if (threadId) {
        console.log(
          `🧵 thread message: user ${shortId(userId)} sent message:`,
          message
        );

        const exists = await threadExists(threadId);
        if (!exists) {
          console.log(`Creating thread ${threadId} from first message`);
          await createThreadFromFirstMessage(threadId);
        }

        await addMessage(
          eventId,
          threadId,
          channelId,
          spaceId,
          userId,
          message,
          createdAt,
          replyId,
          isMentioned,
          mentions
        );
      } else {
        console.log(
          `💬 standalone message: user ${shortId(userId)} sent message:`,
          message
        );
        await addMessage(
          eventId,
          eventId,
          channelId,
          spaceId,
          userId,
          message,
          createdAt,
          replyId,
          isMentioned,
          mentions,
          true
        );
      }
    } catch (error) {
      console.error("Error handling message:", {
        userId: shortId(userId),
        eventId,
        threadId,
        isMentioned,
        error: error instanceof Error ? error.message : String(error),
      });

      if (isMentioned) {
        try {
          await h.sendMessage(
            channelId,
            "Oopsie, I can't find my magic hat that contains the answer for everything!",
            threadId ? { threadId } : { threadId: eventId }
          );
        } catch (replyError) {
          console.error("Failed to send error message:", replyError);
        }
      }
    }
  }
);

bot.onSlashCommand(
  "ask",
  async (
    handler,
    { args, channelId, spaceId, userId, eventId, createdAt, threadId }
  ) => {
    try {
      const question = args.join(" ");

      if (!question) {
        await handler.sendMessage(
          channelId,
          "Please provide a question. Usage: /ask <your question>"
        );
        return;
      }

      await handleAIRequest(handler, {
        message: question,
        userId,
        eventId,
        channelId,
        spaceId,
        createdAt,
        threadId,
      });
    } catch (error) {
      console.error("Error handling /ask command:", {
        userId: shortId(userId),
        eventId,
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });

      try {
        await handler.sendMessage(
          channelId,
          "Oopsie, I can't find my magic hat that contains the answer for everything!",
          threadId ? { threadId } : { threadId: eventId }
        );
      } catch (replyError) {
        console.error("Failed to send error message:", replyError);
      }
    }
  }
);

bot.onSlashCommand(
  "chat",
  async (handler, { args, channelId, userId, eventId }) => {
    try {
      const question = args.join(" ");

      if (!question) {
        await handler.sendMessage(
          channelId,
          "Please provide a question. Usage: /chat <your question>",
          { replyId: eventId }
        );
        return;
      }

      console.log(`💬 /chat command: user ${shortId(userId)} asked:`, question);

      const latestMessages = await getLatestChannelMessages(channelId, 10, 50);
      const enrichedContents = buildEnrichedContext(latestMessages);

      console.log(
        "📝 Enriched context:",
        JSON.stringify(enrichedContents, null, 2)
      );

      const contextMessages = latestMessages.map((msg, idx) => ({
        role:
          msg.userId === bot.botId ? ("assistant" as const) : ("user" as const),
        content: enrichedContents[idx],
      })) satisfies ModelMessage[];

      const userQuestion = {
        role: "user" as const,
        content: question,
      };

      const { text } = await generateText({
        model: openai("gpt-5-nano"),
        system:
          "Help users with their questions based on the recent channel conversation context. Be concise and helpful. Context includes reply chains and mentions in [brackets].",
        messages: [...contextMessages, userQuestion],
        temperature: 0,
      });

      await handler.sendMessage(channelId, text, { replyId: eventId });

      console.log(`✅ /chat response sent to user ${shortId(userId)}`);
    } catch (error) {
      console.error("Error handling /chat command:", {
        userId: shortId(userId),
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });

      try {
        await handler.sendMessage(
          channelId,
          "⚠️ Failed to process your question. Please try again.",
          { replyId: eventId }
        );
      } catch (replyError) {
        console.error("Failed to send error message:", replyError);
      }
    }
  }
);

bot.onSlashCommand(
  "help",
  async (handler, { channelId, threadId, createdAt }) => {
    const now = new Date();
    const ping = now.getTime() - createdAt.getTime();
    const commit = process.env.RENDER_GIT_COMMIT || "dev";
    await handler.sendMessage(
      channelId,
      `Hi, I'm the Wise Beaver. I can answer questions if you mention me or use the \`/ask\` command. (ping: ${ping}ms, commit: ${commit})`,
      { threadId }
    );
  }
);

const { jwtMiddleware, handler } = await bot.start();

const app = new Hono();
app.use(logger());
app.post("/webhook", jwtMiddleware, handler);

export default app;
