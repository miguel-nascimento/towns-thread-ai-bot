import { Experimental_Agent as Agent, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { createTools } from "./tools/index.js";
import type { BotInstance, BotHandler, EventContext } from "./types.js";

export const createAgent = (
  bot: BotInstance,
  handler: BotHandler,
  context: EventContext
) => {
  const tools = createTools(bot, handler, context);

  return new Agent({
    model: openai("gpt-5-nano"),
    system:
      "You are a helpful assistant. Only use digestContent tool when user explicitly asks for 'tldr' or 'summarize'. Be concise and helpful. When rendering content with emojis, add an additional newline after emoji lines for proper formatting.",
    tools,
    stopWhen: stepCountIs(10),
  });
};

export type { BotInstance, BotHandler, EventContext } from "./types.js";
