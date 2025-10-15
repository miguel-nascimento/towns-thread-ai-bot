import { tool } from "ai";
import { z } from "zod";
import { isAddress, type Abi } from "viem";
import { SpaceAddressFromSpaceId } from "@towns-protocol/web3";
import type { BotInstance, EventContext } from "../types.js";

const parseContractArg = (arg: string): string | bigint => {
  if (arg.startsWith("0x")) {
    return arg;
  }

  const numValue = Number(arg);
  if (!Number.isNaN(numValue) && numValue.toString() === arg) {
    return BigInt(arg);
  }

  return arg;
};

const serializeContractResult = (result: unknown): string => {
  if (typeof result === "bigint") {
    return result.toString();
  }

  return JSON.stringify(result, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
};

export const createReadSpaceContract = (
  bot: BotInstance,
  context: EventContext
) =>
  tool({
    description:
      "Read data from the current space's smart contract. Use this when the user wants to check information about THIS space (the current Towns space). Note: The spaceId is the contract address. Examples: 'What's the membership token address?', 'How many members are in this space?'",
    inputSchema: z.object({
      functionName: z
        .string()
        .describe(
          "The function name to call on the space contract (e.g., 'getMembershipTokenAddress', 'getMemberCount', 'hasRole')"
        ),
      abi: z
        .string()
        .describe(
          'The ABI of the function as JSON string. Example: \'[{"inputs":[],"name":"getMembershipTokenAddress","outputs":[{"name":"","type":"address"}],"stateMutability":"view","type":"function"}]\''
        ),
      args: z
        .array(z.string())
        .optional()
        .describe("Arguments for the function call (as string array)"),
    }),
    execute: async (params) => {
      const { functionName, abi, args } = params;
      const spaceAddress = SpaceAddressFromSpaceId(context.spaceId);

      if (!isAddress(spaceAddress)) {
        return `Error: Invalid space address format: ${spaceAddress}`;
      }

      let parsedAbi: Abi;
      try {
        parsedAbi = JSON.parse(abi) as Abi;
      } catch {
        return "Error: Invalid ABI format. Please provide a valid JSON ABI.";
      }

      const contractArgs = args?.map(parseContractArg) ?? [];

      try {
        const result = await bot.readContract({
          address: spaceAddress,
          abi: parsedAbi,
          functionName,
          args: contractArgs,
        });

        return `Space contract call successful. Space Address: ${spaceAddress}. Result: ${serializeContractResult(
          result
        )}`;
      } catch (error) {
        if (error instanceof Error) {
          return `Error reading space contract: ${error.message}. Make sure the function name and ABI are correct. Space ID: ${context.spaceId}`;
        }
        return "Unknown error reading space contract";
      }
    },
  });
