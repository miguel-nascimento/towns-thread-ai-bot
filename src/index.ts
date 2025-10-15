import { generateText, type ToolContent } from "ai";
import { openai } from "@ai-sdk/openai";
import { makeTownsBot, type Bot } from "@towns-protocol/bot";
import { Hono } from "hono";
import { logger } from "hono/logger";
import commands from "./commands.js";
import { createAgent } from "./agent/index.js";

import {
  saveMessage,
  getContext,
  threadExists,
  createThreadFromFirstMessage,
  getLatestChannelMessages,
  buildEnrichedContext,
  isAskThread,
  extractUrls,
  getPendingToolcallWithContext,
  updateToolcallStatus,
  type Context,
} from "./db.js";

const bot = await makeTownsBot(
  process.env.APP_PRIVATE_DATA!,
  process.env.JWT_SECRET!,
  { commands }
);

const shortId = (id: string) => id.slice(0, 4) + ".." + id.slice(-4);

const buildContextMessage = (context: Context, botId: string) => {
  const messages = context.conversation.map((turn) => ({
    role: turn.userId === botId ? ("assistant" as const) : ("user" as const),
    content: turn.message,
  }));

  return messages;
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
      if (threadId && (await isAskThread(threadId))) {
        console.log(
          `🧵 /ask thread message: user ${shortId(userId)} sent:`,
          message
        );

        await saveMessage({
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
        });

        const context = await getContext(threadId);
        if (!context) {
          console.log("Could not retrieve context for thread");
          return;
        }

        const urls = extractUrls(message);
        const urlContext =
          urls.length > 0
            ? `\n\nNote: User shared URLs: ${urls.join(", ")}`
            : "";

        const agent = createAgent(bot, h, {
          eventId,
          channelId,
          spaceId,
          userId,
          threadId,
        });

        const messages = buildContextMessage(context, bot.botId);
        const systemPrompt = `Help users with their questions. Be concise. Context: ${context.initialPrompt}${urlContext}`;

        try {
          const result = await agent.generate({
            messages,
            system: systemPrompt,
          });

          const answer = result.text;

          const { eventId: botEventId } = await h.sendMessage(
            channelId,
            answer,
            {
              threadId,
            }
          );

          await saveMessage({
            eventId: botEventId,
            threadId,
            channelId,
            spaceId,
            userId: bot.botId,
            message: answer,
            createdAt: new Date(),
          });

          console.log(`✅ /ask thread response sent`);
        } catch (error) {
          console.error("Agent error:", error);
          await h.sendMessage(
            channelId,
            "⚠️ AI call failed. Please try again.",
            { threadId }
          );
        }
      } else if (isMentioned) {
        console.log(`💬 Mention: user ${shortId(userId)} asked:`, message);

        await saveMessage({
          eventId,
          threadId: eventId,
          channelId,
          spaceId,
          userId,
          message,
          createdAt,
          isThreadStarter: true,
          isMentioned,
          mentions,
        });

        const latestMessages = await getLatestChannelMessages(
          channelId,
          10,
          50
        );
        const enrichedContents = buildEnrichedContext(latestMessages);

        console.log(
          "📝 Retrieved messages:",
          latestMessages.map((m) => ({
            eventId: shortId(m.eventId),
            userId: shortId(m.userId),
            isBot: m.userId === bot.botId,
            message: m.message.slice(0, 50),
          }))
        );

        console.log(
          "📝 Enriched context:",
          JSON.stringify(enrichedContents, null, 2)
        );

        const urls = extractUrls(message);
        const urlContext =
          urls.length > 0 ? `\nNote: User shared URLs: ${urls.join(", ")}` : "";

        // TODO: need to fix Bot class type
        const agent = createAgent(bot as unknown as Bot, h, {
          eventId,
          channelId,
          spaceId,
          userId,
          threadId: eventId,
        });

        // Send thinking message (top-level message)
        const { eventId: thinkingMessageId } = await h.sendMessage(
          channelId,
          "🌀 Thinking... 🤔💭"
        );

        try {
          const result = await agent.generate({
            system: `Help users with their questions based on the recent channel conversation context. Be concise and helpful. Context includes reply chains and mentions in XML tags.${urlContext}`,
            messages: [
              {
                role: "user" as const,
                content: `<context>\n${enrichedContents.join(
                  "\n"
                )}\n</context>\n\n${message}`,
              },
            ],
          });

          const text = result.text;

          const { eventId: botEventId } = await h.sendMessage(channelId, text);

          await saveMessage({
            eventId: botEventId,
            threadId: eventId,
            channelId,
            spaceId,
            userId: bot.botId,
            message: text,
            createdAt: new Date(),
            replyId: eventId,
            isThreadStarter: false,
          });

          // Delete thinking message
          await h.removeEvent(channelId, thinkingMessageId);

          console.log(`✅ Mention response sent to user ${shortId(userId)}`);
        } catch (error) {
          console.error("Agent error:", error);
          // Delete thinking message on error too
          await h.removeEvent(channelId, thinkingMessageId);
          await h.sendMessage(
            channelId,
            "⚠️ Failed to process your question. Please try again."
          );
        }
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

        await saveMessage({
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
        });
      } else {
        console.log(
          `💬 standalone message: user ${shortId(userId)} sent message:`,
          message
        );
        await saveMessage({
          eventId,
          threadId: eventId,
          channelId,
          spaceId,
          userId,
          message,
          createdAt,
          replyId,
          isMentioned,
          mentions,
          isThreadStarter: true,
        });
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
            "⚠️ Failed to process your question. Please try again.",
            { threadId }
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
  async (handler, { args, channelId, spaceId, userId, eventId, createdAt }) => {
    try {
      const question = args.join(" ");

      if (!question) {
        await handler.sendMessage(
          channelId,
          "Please provide a question. Usage: /ask <your question>"
        );
        return;
      }

      console.log(`💬 /ask command: user ${shortId(userId)} asked:`, question);

      const newThreadId = eventId;
      await saveMessage({
        eventId,
        threadId: newThreadId,
        channelId,
        spaceId,
        userId,
        message: question,
        createdAt,
        isThreadStarter: true,
        isAskThread: true,
      });

      const context = await getContext(newThreadId);
      if (!context) {
        console.log("Could not retrieve context for new thread");
        return;
      }

      const urls = extractUrls(question);
      const urlContext =
        urls.length > 0 ? `\n\nNote: User shared URLs: ${urls.join(", ")}` : "";

      const agent = createAgent(bot as unknown as Bot, handler, {
        eventId,
        channelId,
        spaceId,
        userId,
        threadId: newThreadId,
      });

      const messages = buildContextMessage(context, bot.botId);
      const systemPrompt = `Help users with their questions. Be concise. Context: ${context.initialPrompt}${urlContext}`;

      // Send thinking message (top-level message)
      const { eventId: thinkingMessageId } = await handler.sendMessage(
        channelId,
        "🌀 Thinking... 🤔💭",
        { threadId: newThreadId }
      );

      try {
        const result = await agent.generate({
          messages,
          system: systemPrompt,
        });

        const answer = result.text;

        const { eventId: botEventId } = await handler.sendMessage(
          channelId,
          answer,
          { threadId: newThreadId }
        );

        await saveMessage({
          eventId: botEventId,
          threadId: newThreadId,
          channelId,
          spaceId,
          userId: bot.botId,
          message: answer,
          createdAt: new Date(),
        });

        // Delete thinking message
        await handler.removeEvent(channelId, thinkingMessageId);

        console.log(
          `✅ /ask thread created and response sent to user ${shortId(userId)}`
        );
      } catch (agentError) {
        console.error("Agent error:", agentError);
        // Delete thinking message on error too
        await handler.removeEvent(channelId, thinkingMessageId);
        await handler.sendMessage(
          channelId,
          "⚠️ AI call failed. Please try again.",
          { threadId: newThreadId }
        );
      }
    } catch (error) {
      console.error("Error handling /ask command:", {
        userId: shortId(userId),
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });

      try {
        await handler.sendMessage(
          channelId,
          "⚠️ Failed to process your question. Please try again."
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

bot.onReaction(async (handler, event) => {
  try {
    if (event.reaction !== "✅" && event.reaction !== "❌") {
      return;
    }

    const pendingToolcall = await getPendingToolcallWithContext(
      event.messageId
    );

    if (!pendingToolcall) {
      return;
    }

    if (event.userId !== pendingToolcall.userId) {
      console.log(
        `User ${shortId(
          event.userId
        )} tried to approve/reject toolcall from ${shortId(
          pendingToolcall.userId
        )}`
      );
      return;
    }

    if (event.reaction === "✅") {
      await updateToolcallStatus(pendingToolcall.id, "approved");

      if (pendingToolcall.toolName === "sendMessageToChannel") {
        const toolArgs = JSON.parse(pendingToolcall.toolArgs as string) as {
          targetChannelId: string;
          message: string;
        };

        try {
          await bot.sendMessage(toolArgs.targetChannelId, toolArgs.message);

          await handler.sendMessage(
            pendingToolcall.channelId,
            "✅ Message sent successfully!",
            { threadId: pendingToolcall.threadId }
          );

          console.log(
            `✅ Approved and sent message to channel ${shortId(
              toolArgs.targetChannelId
            )}`
          );
        } catch (error) {
          console.error("Error sending approved message:", error);
          await handler.sendMessage(
            pendingToolcall.channelId,
            "❌ Failed to send message. Please check the channel ID and permissions.",
            { threadId: pendingToolcall.threadId }
          );
        }
      }
    } else if (event.reaction === "❌") {
      await updateToolcallStatus(pendingToolcall.id, "rejected");

      await handler.sendMessage(
        pendingToolcall.channelId,
        "❌ Action cancelled",
        { threadId: pendingToolcall.threadId }
      );

      console.log(`❌ User rejected toolcall ${pendingToolcall.id}`);
    }
  } catch (error) {
    console.error("Error handling reaction:", {
      messageId: event.messageId,
      reaction: event.reaction,
      userId: shortId(event.userId),
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

const { jwtMiddleware, handler } = await bot.start();

const app = new Hono();
app.use(logger());
app.post("/webhook", jwtMiddleware, handler);

export default app;
