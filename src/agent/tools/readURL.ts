import { tool } from "ai";
import { z } from "zod";

export const readURL = tool({
  description: "Fetch and read content from a URL",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to fetch"),
  }),
  execute: async (params) => {
    const { url } = params;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TownsBot/1.0)",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return `Failed to fetch URL: ${response.status} ${response.statusText}`;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text") && !contentType.includes("html")) {
        return "URL does not contain text content";
      }

      const text = await response.text();
      const stripped = text
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const content = stripped.slice(0, 10000);
      return content || "No readable content found";
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          return "Request timeout - URL took too long to respond";
        }
        return `Error fetching URL: ${error.message}`;
      }
      return "Unknown error fetching URL";
    }
  },
});
