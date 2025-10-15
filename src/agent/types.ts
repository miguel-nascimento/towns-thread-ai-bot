import type { Bot } from "@towns-protocol/bot";
import type {
  Abi,
  Address,
  ContractFunctionArgs,
  ContractFunctionName,
} from "viem";

export type EventContext = {
  eventId: string;
  channelId: string;
  spaceId: string;
  userId: string;
  threadId?: string;
};

export type ReadContractConfig<
  TAbi extends Abi = Abi,
  TFunctionName extends ContractFunctionName<
    TAbi,
    "pure" | "view"
  > = ContractFunctionName<TAbi, "pure" | "view">
> = {
  address: Address;
  abi: TAbi;
  functionName: TFunctionName;
  args?: ContractFunctionArgs<TAbi, "pure" | "view", TFunctionName>;
};

export type BotInstance = {
  botId: string;
  readContract: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "pure" | "view">
  >(
    config: ReadContractConfig<TAbi, TFunctionName>
  ) => Promise<unknown>;
  snapshot?: unknown;
};

export type BotHandler = Parameters<Parameters<Bot["onMessage"]>[0]>[0];
