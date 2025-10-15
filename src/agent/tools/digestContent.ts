import { tool, generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

export const digestContent = tool({
  description:
    "Summarize and extract key points from content. ONLY use when user explicitly mentions 'tldr' or 'summarize'",
  inputSchema: z.object({
    content: z.string().describe("The content to summarize"),
    focusArea: z
      .string()
      .optional()
      .describe("Optional area to focus the summary on"),
  }),
  execute: async (params) => {
    const { content, focusArea } = params;
    try {
      const systemPrompt = focusArea
        ? `Summarize the following content with focus on: ${focusArea}. Provide concise bullet points.`
        : "Summarize the following content concisely. Provide key points as bullet points.";

      const { text } = await generateText({
        model: openai("gpt-4o-mini"),
        system: systemPrompt,
        prompt: content.slice(0, 8000),
        temperature: 0,
      });

      return text;
    } catch (error) {
      if (error instanceof Error) {
        return `Error generating summary: ${error.message}`;
      }
      return "Unknown error generating summary";
    }
  },
});
