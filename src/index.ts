import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { makeTownsBot } from "@towns-protocol/bot";
import { Hono } from "hono";
import { logger } from "hono/logger";
import {
  addMessage,
  getContext,
  threadExists,
  createThreadFromFirstMessage,
  type Context,
} from "./db.js";

const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: "https://openrouter.ai/api/v1",
});

const bot = await makeTownsBot(
  process.env.APP_PRIVATE_DATA_BASE64!,
  process.env.JWT_SECRET!
);

bot.onMessage(
  async (h, { message, userId, eventId, channelId, isMentioned, threadId }) => {
    try {
      if (isMentioned && threadId) {
        console.log(
          `📢 mentioned in thread: user ${shortId(userId)} mentioned bot:`,
          message
        );

        const exists = await threadExists(threadId);
        if (!exists) {
          console.log(`Creating thread ${threadId} from first message`);
          await createThreadFromFirstMessage(threadId);
        }

        await addMessage(eventId, threadId, userId, message);

        const context = await getContext(threadId);
        if (!context) {
          console.log("Could not retrieve context for thread");
          return;
        }

        const { ok, answer } = await ai(context, bot.botId);
        if (!ok) {
          await h.sendMessage(
            channelId,
            "⚠️ AI call failed. Please try again.",
            {
              threadId,
            }
          );
          return;
        }

        const { eventId: botEventId } = await h.sendMessage(channelId, answer, {
          threadId,
        });
        await addMessage(botEventId, threadId, bot.botId, answer);
      } else if (isMentioned && !threadId) {
        console.log(
          `📢 mentioned outside thread: user ${shortId(userId)} mentioned bot:`,
          message
        );

        const newThreadId = eventId;
        await addMessage(eventId, newThreadId, userId, message, true);

        const context = await getContext(newThreadId);
        if (!context) {
          console.log("Could not retrieve context for new thread");
          return;
        }

        const { ok, answer } = await ai(context, bot.botId);
        if (!ok) {
          await h.sendMessage(
            channelId,
            "⚠️ AI call failed. Please try again.",
            {
              threadId: newThreadId,
            }
          );
          return;
        }

        const { eventId: botEventId } = await h.sendMessage(channelId, answer, {
          threadId: newThreadId,
        });
        await addMessage(botEventId, newThreadId, bot.botId, answer);
      } else if (threadId && !isMentioned) {
        console.log(
          `🧵 thread message: user ${shortId(userId)} sent message:`,
          message
        );

        const exists = await threadExists(threadId);
        if (!exists) {
          console.log(`Creating thread ${threadId} from first message`);
          await createThreadFromFirstMessage(threadId);
        }

        await addMessage(eventId, threadId, userId, message);
      } else {
        console.log(
          `💬 standalone message: user ${shortId(userId)} sent message:`,
          message
        );
        await addMessage(eventId, eventId, userId, message, true);
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

const buildContextMessage = (context: Context, botId: string) => {
  const systemPrompt = `Help users with their questions. Be concise. Context: ${context.initialPrompt}`;

  const messages = context.conversation.map((turn) => ({
    role: turn.userId === botId ? ("assistant" as const) : ("user" as const),
    content: turn.message,
  }));

  return { systemPrompt, messages };
};

const ai = async (context: Context, botId: string) => {
  try {
    const { systemPrompt, messages } = buildContextMessage(context, botId);

    const { text } = await generateText({
      model: openrouter("deepseek/deepseek-chat-v3.1:free"),
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
const shortId = (id: string) => id.slice(0, 4) + ".." + id.slice(-4);

const { jwtMiddleware, handler } = await bot.start();

const app = new Hono();
app.use(logger());
app.post("/webhook", jwtMiddleware, handler);

export default app;
