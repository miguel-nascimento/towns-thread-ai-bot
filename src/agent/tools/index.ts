import { readURL } from "./readURL.js";
import { digestContent } from "./digestContent.js";
import { createSendMessageToChannel } from "./sendMessageToChannel.js";
import { createReadContract } from "./readContract.js";
import { createReadSpaceContract } from "./readSpaceContract.js";
import type { BotInstance, BotHandler, EventContext } from "../types.js";

export const createTools = (
  bot: BotInstance,
  handler: BotHandler,
  context: EventContext
) => {
  return {
    readURL,
    digestContent,
    sendMessageToChannel: createSendMessageToChannel(handler, context),
    readContract: createReadContract(bot),
    readSpaceContract: createReadSpaceContract(bot, context),
  };
};
