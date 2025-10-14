import type { PlainMessage, SlashCommand } from "@towns-protocol/proto";

const commands = [
  {
    name: "ask",
    description: "Ask the bot a question",
  },
  {
    name: "help",
    description: "Show help",
  },
] as const satisfies PlainMessage<SlashCommand>[];

export default commands;
