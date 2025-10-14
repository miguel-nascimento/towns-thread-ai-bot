import type { PlainMessage, SlashCommand } from "@towns-protocol/proto";

const commands = [
  {
    name: "ask",
    description: "Ask the bot a question",
  },
] as const satisfies PlainMessage<SlashCommand>[];

export default commands;
