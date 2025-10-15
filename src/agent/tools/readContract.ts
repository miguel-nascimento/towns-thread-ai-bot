import { tool } from "ai";
import { z } from "zod";
import { isAddress, type Abi } from "viem";
import type { BotInstance } from "../types.js";

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

export const createReadContract = (bot: BotInstance) =>
  tool({
    description:
      "Read data from any smart contract on the blockchain. Can read token balances, NFT data, or any contract state. If you don't know the contract address or ABI, ask the user for it or search for well-known contracts (e.g., USDC, WETH, etc.).",
    inputSchema: z.object({
      contractAddress: z
        .string()
        .refine((val) => isAddress(val), {
          message: "Invalid Ethereum address format",
        })
        .describe("The contract address (0x...)"),
      functionName: z
        .string()
        .describe(
          "The function name to call (e.g., 'balanceOf', 'ownerOf', 'totalSupply')"
        ),
      abi: z
        .string()
        .describe(
          'The ABI of the function as JSON string. Example: \'[{"inputs":[{"name":"account","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}]\''
        ),
      args: z
        .array(z.string())
        .optional()
        .describe("Arguments for the function call (as string array)"),
    }),
    execute: async (params) => {
      const { contractAddress, functionName, abi, args } = params;

      let parsedAbi: Abi;
      try {
        parsedAbi = JSON.parse(abi) as Abi;
      } catch {
        return "Error: Invalid ABI format. Please provide a valid JSON ABI.";
      }

      const contractArgs = args?.map(parseContractArg) ?? [];

      try {
        const result = await bot.readContract({
          address: contractAddress as `0x${string}`,
          abi: parsedAbi,
          functionName,
          args: contractArgs,
        });

        return `Contract call successful. Result: ${serializeContractResult(
          result
        )}`;
      } catch (error) {
        if (error instanceof Error) {
          return `Error reading contract: ${error.message}. Make sure the contract address, function name, and ABI are correct.`;
        }
        return "Unknown error reading contract";
      }
    },
  });
