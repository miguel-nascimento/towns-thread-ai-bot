import { tool, generateId } from "ai";
import { z } from "zod";
import { savePendingToolcall, saveMessage } from "../../db.js";
import type { BotHandler, EventContext } from "../types.js";

export const createSendMessageToChannel = (
  handler: BotHandler,
  context: EventContext
) =>
  tool({
    description:
      "Send a message to another channel. Requires user approval via reaction.",
    inputSchema: z.object({
      targetChannelId: z
        .string()
        .describe("The channel ID to send the message to"),
      message: z.string().describe("The message content to send"),
    }),
    execute: async (params) => {
      const { targetChannelId, message } = params;
      try {
        const toolcallId = generateId();

        const draftMessage = `📤 **Draft Message for Approval**\n\nTarget Channel: \`${targetChannelId}\`\n\n**Message:**\n${message}\n\nReact with ✅ to send or ❌ to cancel.`;

        const { eventId: draftEventId } = await handler.sendMessage(
          context.channelId,
          draftMessage,
          { threadId: context.threadId }
        );

        await saveMessage({
          eventId: draftEventId,
          threadId: context.threadId || draftEventId,
          channelId: context.channelId,
          spaceId: context.spaceId,
          userId: context.userId,
          message: draftMessage,
          createdAt: new Date(),
          isThreadStarter: !context.threadId,
        });

        await savePendingToolcall({
          id: toolcallId,
          draftEventId,
          originalEventId: context.eventId,
          toolName: "sendMessageToChannel",
          toolArgs: { targetChannelId, message },
        });

        await handler.sendReaction(context.channelId, draftEventId, "✅");
        await handler.sendReaction(context.channelId, draftEventId, "❌");

        return "Draft message sent for approval. Awaiting your reaction (✅ to send, ❌ to cancel).";
      } catch (error) {
        if (error instanceof Error) {
          return `Error creating approval request: ${error.message}`;
        }
        return "Unknown error creating approval request";
      }
    },
  });
